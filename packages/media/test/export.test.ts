import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatClock, ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { analyzeSession } from "../src/analyze.ts";
import { exportSession } from "../src/export.ts";
import { montagePreview } from "../src/montage-preview.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { buildScaffold, entryText, timestamp } from "../src/scaffold.ts";
import { hasFfmpeg, makeDiaryPage, makePhoto, makeSyncDay, makeSyncVideo } from "./fixtures.ts";

describe("Zeitmarken", () => {
  it("schreibt #hh:mm:ss-z# mit Zehntelsekunden", () => {
    expect(timestamp(0)).toBe("#00:00:00-0#");
    expect(timestamp(86_000)).toBe("#00:01:26-0#");
    expect(timestamp(192_940)).toBe("#00:03:12-9#");
    expect(timestamp(3_723_450)).toBe("#01:02:03-5#");
  });
});

describe.skipIf(!hasFfmpeg())("Export eines erzeugten Feldtags", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  const src = (n: string) => store.listSources(sessionId).find((s) => s.fileName === n)!;

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
    // Tagebuch: Eintrag notiert 10:12, Bezug 15 Min. davor (vor der ersten Aufnahme).
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
    rmSync(dir, { recursive: true, force: true });
  });

  it("ordnet Tafel, Episoden, Mitschrift und Fotos nach Uhrzeit", () => {
    const sc = buildScaffold(store, sessionId);
    const lines = sc.entries.map(entryText);
    // Tagebuch vor der ersten Aufnahme: eigene Tafel ganz vorne.
    expect(lines[0]).toMatch(/^#00:00:00-0# Uhrzeit .*Zwischentafel/);
    expect(lines.find((l) => l.includes("Tagebuch"))).toMatch(/^#00:00:00-0# Uhrzeit ca\. 09:57 \(notiert 10:12\)/);
    const episode = sc.plan.segments.find((s) => s.kind === "episode")!;
    expect(formatClock(episode.fromMs)).toBe("10:15:00");
    const line = sc.entries.find((e) => e.kind === "line")!;
    expect(line.montageMs).toBe(episode.montageStartMs + 10_000);
    expect(entryText(line)).toContain("Uhrzeit 10:15:10 · B1: Wie lange schon?");
    // Foto mitten in der Episode an seiner Uhrzeit.
    const photo = sc.entries.find((e) => e.kind === "photo")!;
    expect(photo.montageMs).toBe(episode.montageStartMs + 90_000);
    expect(sc.entries.at(-1)!.montageMs).toBe(sc.plan.durationMs);
  });

  it("schreibt Video, Zeitgerüst und Begleitprotokoll", { timeout: 180_000 }, async () => {
    const out = process.env.FELDSPUR_EXPORT_KEEP ?? join(dir, "export");
    const r = await exportSession(store, sessionId, out);
    expect(r.files).toEqual([
      "Feldtag_2026-09-14_Testmarkt.mp4",
      "Feldtag_2026-09-14_Testmarkt.docx",
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
    expect(probe.chapters.length).toBeGreaterThanOrEqual(2);
    const docx = readFileSync(join(out, r.files[1]!));
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    const csv = readFileSync(join(out, r.files[2]!), "utf8");
    expect(csv.split("\r\n")[0]).toContain("Kurzzeichen;Art;Datei");
    expect(csv).toContain("ZOOM0001.m4a");
  });

  it("zeigt gleichzeitige Videos nebeneinander und mischt den Ton aller Geräte", () => {
    const sc = buildScaffold(store, sessionId);
    const both = montagePreview(sc).pieces.find((p) => p.videos.length === 2)!;
    expect(both.videos.map((v) => v.label).join(" | ")).toMatch(/V-0\d .* \| V-0\d /);
    // Hauptton zuerst (Referenzgerät), danach die Kameras.
    expect(both.audios[0]!.sourceId).toBe(src("ZOOM0001.m4a").id);
    expect(both.audios.length).toBe(3);
  });

  it("plant die Montage zum Ansehen in der App wie das Video", () => {
    const sc = buildScaffold(store, sessionId);
    const p = montagePreview(sc);
    expect(p.durationMs).toBeCloseTo(sc.plan.durationMs, -2);
    let at = 0;
    for (const piece of p.pieces) {
      expect(piece.fromMs).toBeCloseTo(at, 6);
      at = piece.toMs;
    }
    const ep = p.pieces.find((x) => x.kind === "episode" && x.audios.length)!;
    expect(sc.input.sources.some((s) => s.id === ep.audios[0]!.sourceId)).toBe(true);
    expect(p.pieces.some((x) => x.still?.image?.sourceId)).toBe(true);
    expect(p.timeline.episodes.length).toBeGreaterThan(0);
  });

  it("schreibt eine Schnittliste für DaVinci Resolve", async () => {
    const out = join(dir, "resolve");
    const r = await exportSession(store, sessionId, out, { video: false, resolve: true });
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
    // Standbilder liegen neben der Schnittliste.
    const still = /src="(file:[^"]+\.jpg)"/.exec(xml)![1]!;
    expect(existsSync(fileURLToPath(still))).toBe(true);
  });
});
