import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { analyzeSession } from "../src/analyze.ts";
import { exportSession } from "../src/export.ts";
import { montagePreview } from "../src/montage-preview.ts";
import { deviceTracksOf } from "../src/montage-video.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { buildSessionTranscript, entryText, timestamp } from "../src/session-transcript.ts";
import { unzip } from "./xlsx.test.ts";
import { hasFfmpeg, makeDiaryPage, makePhoto, makeSyncDay, makeSyncVideo } from "./fixtures.ts";

describe("Zeitmarken", () => {
  it.each`
    videozeitMs  | marke
    ${0}         | ${"#00:00:00-0#"}
    ${86_000}    | ${"#00:01:26-0#"}
    ${192_940}   | ${"#00:03:12-9#"}
    ${3_723_450} | ${"#01:02:03-5#"}
  `("$videozeitMs ms wird zu $marke (MAXQDA, mit Zehntelsekunde)", ({ videozeitMs, marke }) => {
    expect(timestamp(videozeitMs)).toBe(marke);
  });
});

describe.skipIf(!hasFfmpeg())("Export eines erzeugten Feldtags", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  const src = (n: string) => store.listSources(sessionId).find((s) => s.fileName === n)!;

  // Angenommen: ein abgeglichener Markttag mit Tagebucheintrag (10:12), Foto, zweitem Video und einer Mitschriftzeile
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-export-"));
    const raw = join(dir, "roh");
    makeSyncDay(raw);
    makeDiaryPage(join(raw, "Tagebuch_S01.jpg"), 1);
    makePhoto(join(raw, "IMG_20260914_101630.jpg"), "0x8a4fbf");
    // Zweite Kamera (Handy) läuft gleichzeitig mit dem ersten Kameraclip: Uhrzeit aus dem Dateinamen.
    makeSyncVideo(join(raw, "VID_20260914_101605.mp4"), { seconds: 15 });
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14", extra: { DOI: "10.0000/beispiel" } }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
    store.setReferenceDevice(src("ZOOM0001.m4a").deviceId!);
    await analyzeSession(store, sessionId);
    for (const a of store.listAnchors(sessionId).filter((x) => x.proposed)) store.confirmAnchor(a.id);
    // Tagebuch: Eintrag notiert 10:12 (vor der ersten Aufnahme), Bezug 15 Min. davor.
    store.addDiaryEntry({
      sessionId,
      regions: [{ sourceId: src("Tagebuch_S01.jpg").id, page: 0, x: 0, y: 0, w: 1, h: 0.5 }],
      notedAtMs: Date.UTC(2026, 8, 14, 10, 12),
      mode: "short",
      shortText: "Ankunft, Stände bauen auf",
    });
    store.addTranscriptLine({
      sourceId: src("ZOOM0001.m4a").id,
      atMs: 10_000,
      speaker: "B1",
      text: "Wie lange schon?",
    });
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("ordnet Tafel, Episoden, Mitschrift und Fotos nach Uhrzeit", () => {
    // Wenn: das Einsatztranskript nach Episoden gebaut wird
    const transcript = buildSessionTranscript(store, sessionId, { mode: "episodes" });
    // Dann: Tafel mit Tagebuch vorn, Mitschrift und Foto an ihrer Uhrzeit in der Episode
    expect(transcript.episodes).toBe(true);
    const lines = transcript.entries.map(entryText);
    // Tagebuch vor der ersten Aufnahme: eigene Tafel ganz vorne.
    expect(lines[0]).toMatch(/^#00:00:00-0# Uhrzeit .*Zwischentafel/);
    expect(lines.find((l) => l.includes("Tagebuch"))).toMatch(
      /^#00:00:00-0# Uhrzeit 10:12 \(notiert, bezieht sich auf ca\. 09:57–10:12\)/,
    );
    const episode = transcript.plan.segments.find((s) => s.kind === "episode")!;
    expect(formatClock(episode.fromMs)).toBe("10:15:00");
    const line = transcript.entries.find((e) => e.kind === "line")!;
    expect(line.montageMs).toBe(episode.montageStartMs + 10_000);
    expect(entryText(line)).toContain("Uhrzeit 10:15:10 · B1: Wie lange schon?");
    // Foto mitten in der Episode an seiner Uhrzeit.
    const photo = transcript.entries.find((e) => e.kind === "photo")!;
    expect(photo.montageMs).toBe(episode.montageStartMs + 90_000);
    expect(transcript.entries.at(-1)!.montageMs).toBe(transcript.plan.durationMs);
  });

  it("läuft ohne Wunsch in Echtzeit und nennt keine Episoden", () => {
    // Wenn: das Einsatztranskript ohne Wunsch gebaut wird
    const transcript = buildSessionTranscript(store, sessionId);
    // Dann: Echtzeit ohne Episoden, Videozeit folgt der Uhrzeit
    expect(transcript.plan.mode).toBe("realtime");
    expect(transcript.episodes).toBe(false);
    expect(transcript.header.modeLabel).toBe("Echtzeit");
    const lines = transcript.entries.map(entryText);
    expect(lines.some((l) => /Episode|Zwischentafel|Zwischenzeit/.test(l))).toBe(false);
    // Videozeit = Uhrzeit ab dem ersten Ereignis (Tagebuch 10:12, notiert).
    const line = transcript.entries.find((e) => e.kind === "line")!;
    const first = transcript.plan.segments[0]!.fromMs;
    expect(entryText(line)).toContain("Uhrzeit 10:15:10 · B1: Wie lange schon?");
    expect(transcript.plan.toMontage(first + 60_000)).toBe(60_000);
    // Wenn: Episoden benannt werden, dann bleibt die Echtzeit-Montage gleich lang, nur mit Episodenzeilen
    const named = buildSessionTranscript(store, sessionId, { episodes: true });
    expect(named.plan.durationMs).toBe(transcript.plan.durationMs);
    expect(named.entries.some((e) => e.kind === "episode")).toBe(true);
    expect(named.header.montageId).not.toBe(transcript.header.montageId);
  });

  it("schreibt Video, Einsatztranskript und Begleitprotokoll", { timeout: 180_000 }, async () => {
    // Wenn: mit Gerätespuren ausgegeben wird
    const out = join(dir, "export");
    const r = await exportSession(store, sessionId, out, { deviceTracks: true });
    // Dann: vier Dateien; Bild und Ton gleich lang; Mischung und je Gerät eine Tonspur; .docx, Variablen und Protokoll lesbar
    expect(r.files).toEqual([
      "Feldtag_2026-09-14_Testmarkt.mp4",
      "Feldtag_2026-09-14_Testmarkt.docx",
      "Feldtag_2026-09-14_Testmarkt_Variablen.xlsx",
      "Feldtag_2026-09-14_Testmarkt_Begleitprotokoll.csv",
    ]);
    const probe = JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,duration",
        "-show_chapters",
        "-of",
        "json",
        join(out, r.files[0]!),
      ]).toString(),
    ) as { format: { duration: string }; streams: { codec_type: string; duration: string }[]; chapters: unknown[] };
    const dur = Number(probe.format.duration) * 1000;
    expect(Math.abs(dur - r.durationMs)).toBeLessThan(120);
    const [v, a] = ["video", "audio"].map(
      (k) => Number(probe.streams.find((s) => s.codec_type === k)!.duration) * 1000,
    );
    // Bild und Ton bleiben auf einer Linie.
    expect(Math.abs(v! - a!)).toBeLessThan(80);
    // Echtzeit ohne Episoden: keine Kapitel.
    expect(probe.chapters.length).toBe(0);
    // Tonspuren: zuerst die Mischung als Standard, danach je Gerät eine Spur, alle so lang wie das Bild.
    // MP4 speichert den Spurnamen als handler_name; VLC und Schnittprogramme zeigen ihn an.
    const tracks = JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=duration:stream_tags=title,handler_name:stream_disposition=default",
        "-of",
        "json",
        join(out, r.files[0]!),
      ]).toString(),
    ) as { streams: { duration: string; tags: { handler_name?: string }; disposition: { default: number } }[] };
    const devices = deviceTracksOf(buildSessionTranscript(store, sessionId));
    expect(devices.length).toBeGreaterThanOrEqual(2);
    expect(devices[0]!.title).toBe(store.listDevices(sessionId).find((d) => d.isReference)!.label);
    expect(tracks.streams.map((t) => t.tags.handler_name)).toEqual([
      "Mischung aller Geräte",
      ...devices.map((d) => d.title),
    ]);
    expect(tracks.streams.map((t) => t.disposition.default)).toEqual([1, ...devices.map(() => 0)]);
    for (const t of tracks.streams) expect(Math.abs(Number(t.duration) * 1000 - v!)).toBeLessThan(80);
    const docx = readFileSync(join(out, r.files[1]!));
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    const vars = unzip(readFileSync(join(out, r.files[2]!)))["xl/worksheets/sheet1.xml"]!;
    expect(vars).toContain(">Dokumentname<");
    expect(vars).toContain(">Feldtag_2026-09-14_Testmarkt<");
    const csv = readFileSync(join(out, r.files[3]!), "utf8");
    expect(csv.split("\r\n")[0]).toContain("Kurzzeichen;Art;Datei");
    expect(csv).toContain("ZOOM0001.m4a");
  });

  it("räumt Video, Viewer und Schnittliste einer früheren Ausgabe weg, wenn sie diesmal fehlen (#227)", async () => {
    // Angenommen: im Ordner liegen Video, Viewer und Schnittliste einer früheren Ausgabe und eine fremde Datei
    const out = join(dir, "ohne-video");
    mkdirSync(out, { recursive: true });
    const alt = [
      "Feldtag_2026-09-14_Testmarkt.mp4",
      "Feldtag_2026-09-14_Testmarkt.html",
      "Feldtag_2026-09-14_Testmarkt_Resolve.fcpxml",
    ];
    for (const f of [...alt, "eigene-notiz.txt"]) writeFileSync(join(out, f), "alt");
    // Wenn: ohne Video und ohne Schnittliste ausgegeben wird
    const r = await exportSession(store, sessionId, out, { video: false, previousFiles: alt });
    // Dann: liegen nur die neuen Dateien und die fremde Datei im Ordner
    expect(readdirSync(out).sort()).toEqual([...r.files, "eigene-notiz.txt"].sort());
  });

  it("bricht mit vorab abgebrochenem Signal ab, ohne etwas zu schreiben", async () => {
    // Wenn: mit einem schon abgebrochenen Signal ausgegeben wird
    const out = join(dir, "abgebrochen");
    await expect(exportSession(store, sessionId, out, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
    // Dann: Abbruch, und der Ordner entsteht gar nicht
    expect(existsSync(out)).toBe(false);
  });

  it("beendet ffmpeg beim Abbrechen und behält fertige Abschnitte", { timeout: 180_000 }, async () => {
    const out = join(dir, "mittendrin");
    const cacheDir = join(dir, "zwischenspeicher");
    const ctrl = new AbortController();
    const chunk = /^[0-9a-f]{40}\.mp4$/;
    // Wenn: abgebrochen wird, sobald der erste Abschnitt fertig ist
    const run = exportSession(store, sessionId, out, {
      cacheDir,
      signal: ctrl.signal,
      // Abbrechen, sobald der erste Abschnitt fertig im Zwischenspeicher liegt (die anderen rechnen dann noch).
      onProgress: (step) => {
        if (step === "Montagevideo" && existsSync(cacheDir) && readdirSync(cacheDir).some((f) => chunk.test(f)))
          ctrl.abort();
      },
    });
    // Dann: Abbruch, nichts im Ausgabeordner, fertige Abschnitte bleiben im Zwischenspeicher
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(readdirSync(out)).toEqual([]);
    expect(readdirSync(cacheDir).filter((f) => chunk.test(f)).length).toBeGreaterThan(0);
  });

  it("zeigt gleichzeitige Videos nebeneinander und mischt den Ton aller Geräte", () => {
    // Wenn: die Montage geplant wird
    const transcript = buildSessionTranscript(store, sessionId);
    const both = montagePreview(transcript).pieces.find((p) => p.videos.length === 2)!;
    // Dann: zwei gleichzeitige Videos nebeneinander, Ton von drei Geräten, Referenz zuerst
    expect(both.videos.map((v) => v.label).join(" | ")).toMatch(/V-0\d .* \| V-0\d /);
    // Hauptton zuerst (Referenzgerät), danach die Kameras.
    expect(both.audios[0]!.sourceId).toBe(src("ZOOM0001.m4a").id);
    expect(both.audios.length).toBe(3);
  });

  it("plant die Montage zum Ansehen in der App wie das Video", () => {
    // Wenn: die Montage zum Ansehen in der App geplant wird
    const transcript = buildSessionTranscript(store, sessionId);
    const p = montagePreview(transcript);
    // Dann: so lang wie das Video, lückenlos, mit Ton aus echten Quellen und einer Montage-ID
    expect(p.durationMs).toBeCloseTo(transcript.plan.durationMs, -2);
    let at = 0;
    for (const piece of p.pieces) {
      expect(piece.fromMs).toBeCloseTo(at, 6);
      at = piece.toMs;
    }
    const ep = p.pieces.find((x) => x.kind === "episode" && x.audios.length)!;
    expect(transcript.input.sources.some((s) => s.id === ep.audios[0]!.sourceId)).toBe(true);
    expect(p.header.montageId).toMatch(/^FS-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    // Das Video trägt die ersten beiden Blöcke, das Einsatztranskript alle drei.
    expect(transcript.header.montageId).toMatch(/^FS-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(transcript.header.montageId.startsWith(`${p.header.montageId}-`)).toBe(true);
  });

  it("schreibt eine Schnittliste für DaVinci Resolve", async () => {
    // Wenn: nur die Schnittliste für Resolve nach Episoden ausgegeben wird
    const out = join(dir, "resolve");
    const r = await exportSession(store, sessionId, out, { video: false, resolve: true, mode: "episodes" });
    // Dann: lückenlose Hauptspur, Mitschrift als Marker, Episoden als Kapitel, keine Standbilder
    expect(r.files).toContain("Feldtag_2026-09-14_Testmarkt_Episoden.docx");
    const name = r.files.find((f) => f.endsWith(".fcpxml"))!;
    const xml = readFileSync(join(out, name), "utf8");
    if (process.env.FELDSPUR_FCPXML_KEEP) writeFileSync(process.env.FELDSPUR_FCPXML_KEEP, xml);
    expect(xml).toContain('<fcpxml version="1.9">');
    // Lückenlos: jedes Element der Hauptspur beginnt, wo das vorige endet.
    const spine = [...xml.matchAll(/^ {8}<(?:asset-clip|gap) [^>]*offset="([^"]+)"[^>]*duration="([^"]+)"/gm)];
    const frames = (v: string) => (v === "0s" ? 0 : Number(v.replace("/25s", "")));
    let at = 0;
    for (const [, off, len] of spine) {
      expect(frames(off!)).toBe(at);
      at += frames(len!);
    }
    expect(at).toBe(Math.round(r.durationMs / 40));
    expect(xml).toContain('srcEnable="video"');
    expect(xml).toMatch(/<marker [^>]*value="[^"]*B1: Wie lange schon\?"/);
    expect(xml).toMatch(/<chapter-marker [^>]*Episode 1/);
    // Keine Standbilder mehr: Fotos und Scans stehen im Einsatztranskript.
    expect(xml).not.toMatch(/\.jpg"/);
  });
  // So steht es im Handbuch (Abschnitt „Montage-ID“): Blöcke 1 und 2 hängen am Zeitgefüge, Block 3 am Text.
  it("Montage-ID: Text ändert nur den dritten Block, Lage und Quellen auch die ersten beiden", () => {
    const header = (mode?: "episodes") => buildSessionTranscript(store, sessionId, { mode }).header;
    // Angenommen: die ID des Einsatzes, sie bleibt bei erneuter Berechnung gleich
    const before = header();
    expect(header().montageId).toBe(before.montageId);
    expect(before.montageId.slice(0, 12)).toBe(before.montageVideoId);
    const text = (id: string) => id.slice(13);

    // Wenn: Mitschrift, Tagebuchtext und Angaben geändert werden, dann jeweils neuer Textblock, Montage bleibt
    const seen = new Set([before.montageId]);
    const changed = () => {
      const h = header();
      expect(h.montageVideoId).toBe(before.montageVideoId);
      expect(seen.has(h.montageId)).toBe(false);
      seen.add(h.montageId);
    };
    const line = store.addTranscriptLine({ sourceId: src("ZOOM0001.m4a").id, atMs: 12_000, text: "Seit sieben." });
    changed();
    const entry = store.listDiaryEntries(sessionId)[0]!;
    store.updateDiaryEntry(entry.id, { shortText: "Ankunft, die Stände bauen auf" });
    changed();
    const session = store.getSession(sessionId);
    store.updateSession(sessionId, { extra: { DOI: "10.0000/anders" } });
    changed();
    // Wenn: alles zurückgestellt ist, dann gilt wieder genau die alte ID
    store.deleteTranscriptLine(line.id);
    store.updateDiaryEntry(entry.id, { shortText: entry.shortText });
    store.updateSession(sessionId, { extra: session.extra });
    expect(header().montageId).toBe(before.montageId);

    // Wenn: ein Foto eine Sekunde später liegt, dann ändern sich die ersten beiden Blöcke (und der Text mit)
    const photo = src("IMG_20260914_101630.jpg");
    const evs = store.listEvidence(sessionId).filter((e) => e.sourceId === photo.id);
    expect(evs.length).toBeGreaterThan(0);
    for (const e of evs) store.updateEvidenceTime(e.id, e.localMs + 1_000);
    expect(header().montageVideoId).not.toBe(before.montageVideoId);
    expect(text(header().montageId)).not.toBe(text(before.montageId));
    for (const e of evs) store.updateEvidenceTime(e.id, e.localMs);
    expect(header().montageId).toBe(before.montageId);

    // Wenn: nach Episoden statt in Echtzeit montiert wird, dann ist die Montage ebenfalls neu
    expect(header("episodes").montageVideoId).not.toBe(before.montageVideoId);
  });
});
