/**
 * Montagevideo, wo kein Video läuft (`renderMontage` in `packages/media/src/montage-video.ts`): Dort steht je Sekunde
 * ein Bild, statt 25-mal dasselbe (Issue #249). Bildspur und Ton bleiben trotzdem gleich lang.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { applyImport, scanPaths } from "../src/import.ts";
import { FPS } from "../src/layout.ts";
import { planPieces, renderMontage } from "../src/montage-video.ts";
import { buildSessionTranscript } from "../src/session-transcript.ts";
import { hasFfmpeg, makeAudio, makeVideo } from "./fixtures.ts";

/** Beginn jedes Bilds der Bildspur, in Sekunden. */
function videoFrames(file: string): { at: number }[] {
  const out = execFileSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "packet=pts_time",
    "-of",
    "csv=p=0",
    file,
  ]).toString();
  return out
    .trim()
    .split("\n")
    .map((l) => ({ at: Number(l.split(",")[0]) }))
    .sort((a, b) => a.at - b.at);
}

describe.skipIf(!hasFfmpeg())("Montagevideo ohne laufendes Video", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-montage-standbild-"));
    const raw = join(dir, "roh");
    mkdirSync(raw);
    // 8,5 s Ton; mittendrin 3 s Video. Davor und danach läuft nur der Ton.
    makeAudio(join(raw, "ZOOM0001.m4a"), { seconds: 8.5, creationTime: "2026-09-14T08:15:00.000000Z" });
    makeVideo(join(raw, "C0001.MP4"), { seconds: 3, creationTime: "2026-09-14T08:15:02.000000Z" });
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Standbild", date: "2026-09-14" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("zeigt je Sekunde ein Bild und bleibt so lang wie der Ton", { timeout: 120_000 }, async () => {
    // Angenommen: eine Montage aus Ton allein, Ton mit Video und wieder Ton allein
    const transcript = buildSessionTranscript(store, sessionId);
    const pieces = planPieces(transcript);
    expect(pieces.map((p) => p.videos.length)).toEqual([0, 1, 0]);
    // Wenn: das Montagevideo entsteht
    const out = join(dir, "montage.mp4");
    await renderMontage(transcript, out, { workDir: join(dir, "arbeit"), cacheDir: join(dir, "zwischenspeicher") });
    // Dann: ohne Video ein Bild je angefangener Sekunde, mit Video 25 je Sekunde
    const frames = videoFrames(out);
    const expected = pieces.map((p) => (p.videos.length ? p.f1 - p.f0 : Math.ceil((p.f1 - p.f0) / FPS)));
    expect(frames.length).toBe(expected.reduce((a, b) => a + b, 0));
    // Dann: jedes Stück beginnt auf das Bild genau an seiner Stelle, die Standbilder folgen im Sekundentakt
    let n = 0;
    for (const [i, p] of pieces.entries()) {
      for (let k = 0; k < expected[i]!; k++)
        expect(frames[n + k]!.at).toBeCloseTo(p.f0 / FPS + k * (p.videos.length ? 1 / FPS : 1), 3);
      n += expected[i]!;
    }
    // Dann: Bild und Ton enden zusammen, das letzte Standbild also mit der Montage und nicht nach einer vollen Sekunde
    const streams = JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,duration",
        "-of",
        "json",
        out,
      ]).toString(),
    ) as { streams: { codec_type: string; duration: string }[] };
    const [v, a] = ["video", "audio"].map((k) => Number(streams.streams.find((s) => s.codec_type === k)!.duration));
    expect(Math.abs(v! - a!)).toBeLessThan(0.08);
    expect(v!).toBeCloseTo(pieces.at(-1)!.f1 / FPS, 2);
  });
});
