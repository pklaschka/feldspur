import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { analyzeSession } from "../src/analyze.ts";
import { exportSession } from "../src/export.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { deviceTracksOf } from "../src/montage-video.ts";
import { buildSessionTranscript, timestamp } from "../src/session-transcript.ts";
import { clockAtMontage, sessionTranscriptHtml, VIEWER_CSP, viewerData, viewerScript } from "../src/viewer/html.ts";
import { readMp4Audio } from "../src/viewer/mp4-audio.ts";
import { hasFfmpeg, makeDiaryPage, makePhoto, makeSyncDay, makeSyncVideo } from "./fixtures.ts";

describe("Viewer: Skript", () => {
  it("ist gültiges JavaScript ohne Bezüge nach außen", () => {
    const js = viewerScript();
    // Wirft bei einem Syntaxfehler, etwa wenn Function#toString etwas Unerwartetes liefert.
    expect(() => new Function(js)).not.toThrow();
    expect(js).not.toMatch(/\bimport\s*\(|\brequire\(|fetch\(|XMLHttpRequest|localStorage/);
    expect(js).not.toMatch(/<\/script/i);
  });
});

describe.skipIf(!hasFfmpeg())("Viewer neben dem Montagevideo", () => {
  let dir: string;
  let out: string;
  let store: ProjectStore;
  let sessionId: string;
  let files: string[];
  const src = (n: string) => store.listSources(sessionId).find((s) => s.fileName === n)!;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-viewer-"));
    const raw = join(dir, "roh");
    makeSyncDay(raw);
    makeDiaryPage(join(raw, "Tagebuch_S01.jpg"), 1);
    makePhoto(join(raw, "IMG_20260914_101630.jpg"), "0x8a4fbf");
    makeSyncVideo(join(raw, "VID_20260914_101605.mp4"), { seconds: 15 });
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Testmarkt <&>", date: "2026-09-14", place: "Markt" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
    store.setReferenceDevice(src("ZOOM0001.m4a").deviceId!);
    await analyzeSession(store, sessionId);
    for (const a of store.listAnchors(sessionId).filter((x) => x.proposed)) store.confirmAnchor(a.id);
    store.addDiaryEntry({
      sessionId,
      regions: [{ sourceId: src("Tagebuch_S01.jpg").id, page: 0, x: 0, y: 0, w: 1, h: 0.5 }],
      notedAtMs: Date.UTC(2026, 8, 14, 10, 16),
      mode: "short",
      shortText: "Ankunft, Stände bauen auf",
    });
    store.addTranscriptLine({
      sourceId: src("ZOOM0001.m4a").id,
      atMs: 10_000,
      speaker: "B1",
      text: "Wie lange schon? </script><b>",
    });
    out = join(dir, "aus");
    files = (await exportSession(store, sessionId, out, { deviceTracks: true, viewer: true })).files;
  }, 240_000);
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("schreibt die HTML-Datei neben Video und Einsatztranskript", () => {
    const base = files[0]!.replace(/\.mp4$/, "");
    expect(files).toEqual([".mp4", ".docx", ".html", "_Variablen.xlsx", "_Begleitprotokoll.csv"].map((x) => base + x));
  });

  it("ist selbsttragend: nichts von außen, alles maskiert, jede Zeile als HTML", () => {
    const html = readFileSync(join(out, files[2]!), "utf8");
    expect(html).toContain(`content="${VIEWER_CSP}"`);
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).toContain(`<video id="vid" src="${encodeURIComponent(files[0]!).replace(/&/g, "&amp;")}"`);
    // Mitschrift und Titel sind maskiert; ein „</script>“ im Text beendet nichts.
    expect(html).toContain("Wie lange schon? &lt;/script&gt;&lt;b&gt;");
    expect(html).toContain("<h1>Testmarkt &lt;&amp;&gt;</h1>");
    const transcript = buildSessionTranscript(store, sessionId);
    expect(html.match(/<li class="ln k-/g)?.length).toBe(transcript.entries.length);
    // Zeitmarken wie im .docx.
    for (const e of transcript.entries) expect(html).toContain(timestamp(e.montageMs));
    // Bilder eingebettet (Foto und Tagebuchausschnitt).
    expect(html.match(/<img src="data:image\/jpeg;base64,/g)?.length).toBe(2);
    expect(html).toContain('<span class="sp">B1: </span>');
    // Daten für das Skript: lesbar, ohne rohes „<“.
    const json = /<script type="application\/json" id="feldspur-daten">(.*?)<\/script>/s.exec(html)![1]!;
    expect(json).not.toContain("<");
    const data = JSON.parse(json) as ReturnType<typeof viewerData>;
    const devices = deviceTracksOf(transcript);
    expect(data.audio).toEqual(["Mischung aller Geräte", ...devices.map((d) => d.title)]);
    expect(data.lanes.map((l) => [l.title, l.audio])).toEqual(devices.map((d, k) => [d.title, k + 1]));
    expect(data.lanes[0]!.ref).toBe(true);
    // Wellenform je Aufnahme aus der Tonspur-Analyse: ein Byte je Wert, über die ganze Länge.
    for (const c of data.lanes.flatMap((l) => l.clips)) {
      expect(c.ws).toBeGreaterThanOrEqual(250);
      expect(Buffer.from(c.w!, "base64").length).toBe(Math.ceil((c.m1 - c.m0) / c.ws!));
    }
    expect(Math.max(...Buffer.from(data.lanes[0]!.clips[0]!.w!, "base64"))).toBeGreaterThan(100);
    expect(data.durationMs).toBe(Math.round(transcript.plan.durationMs));
  });

  it("findet die Tonspuren im Video und liest sie Paket für Paket wie ffmpeg", async () => {
    const mp4 = readFileSync(join(out, files[0]!));
    const info = await readMp4Audio(async (o, l) => mp4.subarray(o, o + l), mp4.length);
    const titles = buildSessionTranscript(store, sessionId);
    expect(info.audio.map((a) => a.title)).toEqual([
      "Mischung aller Geräte",
      ...deviceTracksOf(titles).map((d) => d.title),
    ]);
    expect(info.trackCount).toBe(info.audio.length + 1);
    for (const a of info.audio) {
      expect(a.codec).toBe("mp4a.40.2");
      expect(a.sampleRate).toBe(48_000);
      expect(a.config?.length).toBeGreaterThanOrEqual(2);
      const last = a.offsets.length - 1;
      expect(a.times[last]! + a.durations[last]!).toBeCloseTo(info.durationS, 0);
      // Schnittliste: der AAC-Vorlauf liegt vor 0.
      expect(a.times[0]!).toBeLessThanOrEqual(0);
      expect(a.offsets[last]! + a.sizes[last]!).toBeLessThanOrEqual(mp4.length);
    }
    // Dieselben Bytes wie ffmpeg für Spur 2 (ADTS-Köpfe von 7 Byte abgezogen).
    const adts = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", join(out, files[0]!), "-map", "0:a:1", "-c", "copy", "-f", "adts", "-"],
      {
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const tk = info.audio[1]!;
    let p = 0;
    for (let i = 0; i < tk.sizes.length; i++) {
      const len = ((adts[p + 3]! & 3) << 11) | (adts[p + 4]! << 3) | (adts[p + 5]! >> 5);
      const head = adts[p + 1]! & 1 ? 7 : 9;
      const ours = mp4.subarray(tk.offsets[i]!, tk.offsets[i]! + tk.sizes[i]!);
      expect(Buffer.compare(adts.subarray(p + head, p + len), ours)).toBe(0);
      p += len;
    }
    expect(p).toBe(adts.length);
  });

  it("rechnet Uhrzeit aus Videozeit wie das Skript", () => {
    const t = buildSessionTranscript(store, sessionId);
    const first = t.plan.segments[0]!;
    expect(clockAtMontage(t.plan, 0)).toBe(first.fromMs);
    expect(clockAtMontage(t.plan, 61_000)).toBe(first.fromMs + 61_000);
  });

  it("schreibt ohne Gerätespuren keine Spurdaten", () => {
    const t = buildSessionTranscript(store, sessionId);
    const html = sessionTranscriptHtml(t, { mediaFileName: "x.mp4", stills: new Map() });
    const data = JSON.parse(/id="feldspur-daten">(.*?)<\/script>/s.exec(html)![1]!) as ReturnType<typeof viewerData>;
    expect(data.audio).toHaveLength(1);
    expect(data.lanes.every((l) => l.audio === -1)).toBe(true);
    expect(html).toContain('<span class="noimg">');
  });
});
