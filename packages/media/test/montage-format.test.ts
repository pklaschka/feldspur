/**
 * Montagevideo in wählbarer Auflösung und Bildrate (Issue #250, `MontageFormat` in `packages/media/src/layout.ts`):
 * Größe und Bildtakt der Datei, Einblendungen in passender Größe, Ton und Bild gleich lang, Zwischenspeicher je Format.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { applyImport, scanPaths } from "../src/import.ts";
import { montageLayout, type MontageFormat } from "../src/layout.ts";
import { estimateMontageBytes, planPieces, renderMontage, type OverlayRenderer } from "../src/montage-video.ts";
import { buildSessionTranscript, type SessionTranscript } from "../src/session-transcript.ts";
import { hasFfmpeg, makeAudio, makeVideo } from "./fixtures.ts";

/** Bildspur und Tonspur: Maße, Länge und der Beginn jedes Bilds in Sekunden. */
function probe(file: string) {
  const json = (args: string[]) =>
    JSON.parse(execFileSync("ffprobe", ["-v", "error", ...args, "-of", "json", file]).toString());
  const { streams } = json(["-show_entries", "stream=codec_type,width,height,duration"]) as {
    streams: { codec_type: string; width?: number; height?: number; duration: string }[];
  };
  const v = streams.find((s) => s.codec_type === "video")!;
  const a = streams.find((s) => s.codec_type === "audio")!;
  const { packets } = json(["-select_streams", "v:0", "-show_entries", "packet=pts_time"]) as {
    packets: { pts_time: string }[];
  };
  return {
    width: v.width,
    height: v.height,
    video: Number(v.duration),
    audio: Number(a.duration),
    frames: packets.map((p) => Number(p.pts_time)).sort((x, y) => x - y),
  };
}

/** Einblendung als durchsichtiges PNG in der verlangten Größe; merkt sich, welche Formate verlangt wurden. */
function transparentPng(dir: string, w: number, h: number): Buffer {
  const file = join(dir, `leer-${w}x${h}.png`);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black@0:s=${w}x${h},format=rgba`,
    "-frames:v",
    "1",
    file,
  ]);
  return readFileSync(file);
}

describe.skipIf(!hasFfmpeg())("Montagevideo in anderer Auflösung und Bildrate", () => {
  let dir: string;
  let store: ProjectStore;
  let transcript: SessionTranscript;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-montage-format-"));
    const raw = join(dir, "roh");
    mkdirSync(raw);
    // 5,5 s Ton; mittendrin 2 s Video. Davor und danach läuft nur der Ton.
    makeAudio(join(raw, "ZOOM0001.m4a"), { seconds: 5.5, creationTime: "2026-09-14T08:15:00.000000Z" });
    makeVideo(join(raw, "C0001.MP4"), { seconds: 2, creationTime: "2026-09-14T08:15:01.700000Z" });
    store = ProjectStore.open(":memory:");
    const sessionId = store.addSession({ title: "Format", date: "2026-09-14" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
    transcript = buildSessionTranscript(store, sessionId);
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it.each`
    breite  | hoehe   | bilder
    ${640}  | ${360}  | ${10}
    ${960}  | ${540}  | ${15}
    ${1920} | ${1080} | ${30}
  `(
    "$breite × $hoehe mit $bilder Bildern je Sekunde: Datei, Einblendungen und Bildtakt passen",
    { timeout: 120_000 },
    async ({ breite, hoehe, bilder }: { breite: number; hoehe: number; bilder: number }) => {
      // Angenommen: das Projekt gibt in diesem Format aus
      const format: MontageFormat = { height: hoehe, fps: bilder };
      const pieces = planPieces(transcript, bilder);
      expect(pieces.map((p) => p.videos.length)).toEqual([0, 1, 0]);
      const asked: MontageFormat[] = [];
      const overlay: OverlayRenderer = async (_head, frames, f) => {
        asked.push(f);
        const { w, h } = montageLayout(f);
        return frames.map(() => transparentPng(dir, w, h));
      };
      // Wenn: das Montagevideo entsteht
      const out = join(dir, `montage-${hoehe}p${bilder}.mp4`);
      await renderMontage(transcript, out, {
        workDir: join(dir, `arbeit-${hoehe}`),
        cacheDir: join(dir, `zwischenspeicher-${hoehe}`),
        overlay,
        format,
      });
      const got = probe(out);
      // Dann: die Datei hat die gewählte Größe, und die Einblendungen wurden in genau diesem Format gezeichnet
      expect([got.width, got.height]).toEqual([breite, hoehe]);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((f) => f.height === hoehe && f.fps === bilder)).toBe(true);
      // Dann: mit Video so viele Bilder je Sekunde wie gewählt, ohne Video eins je angefangener Sekunde
      const expected = pieces.map((p) => (p.videos.length ? p.f1 - p.f0 : Math.ceil((p.f1 - p.f0) / bilder)));
      expect(got.frames.length).toBe(expected.reduce((a, b) => a + b, 0));
      let n = 0;
      for (const [i, p] of pieces.entries()) {
        for (let k = 0; k < expected[i]!; k++)
          expect(got.frames[n + k]!).toBeCloseTo(p.f0 / bilder + k * (p.videos.length ? 1 / bilder : 1), 2);
        n += expected[i]!;
      }
      // Dann: Bild und Ton enden zusammen, mit der Montage, bis auf höchstens ein Bild (wie in montage-standbild.test.ts:
      // je nach ffmpeg-Fassung meldet ffprobe eine der Spuren um ein Bild anders, etwa das ffmpeg aus choco unter Windows)
      expect(Math.abs(got.video - got.audio)).toBeLessThan(1 / bilder + 0.01);
      expect(got.video).toBeCloseTo(pieces.at(-1)!.f1 / bilder, 2);
    },
  );

  it(
    "ein anderes Format rechnet die Abschnitte neu, statt die des Standardformats zu übernehmen",
    { timeout: 120_000 },
    async () => {
      // Angenommen: derselbe Einsatz wurde schon in 1280 × 720 ausgegeben
      const cacheDir = join(dir, "zwischenspeicher-gemeinsam");
      await renderMontage(transcript, join(dir, "standard.mp4"), { workDir: join(dir, "a1"), cacheDir });
      const before = readdirSync(cacheDir).filter((f) => !f.startsWith("ton-"));
      // Wenn: er danach in 640 × 360 bei 25 Bildern/s ausgegeben wird (gleiche Bildgrenzen, andere Größe)
      const out = join(dir, "klein.mp4");
      await renderMontage(transcript, out, { workDir: join(dir, "a2"), cacheDir, format: { height: 360, fps: 25 } });
      // Dann: das Video hat die neue Größe, und keiner der alten Abschnitte wurde übernommen
      expect([probe(out).width, probe(out).height]).toEqual([640, 360]);
      const after = readdirSync(cacheDir).filter((f) => !f.startsWith("ton-"));
      expect(after.some((f) => before.includes(f))).toBe(false);
    },
  );

  it("schätzt kleinere Formate kleiner und größere größer", () => {
    const size = (height: number, fps: number) => estimateMontageBytes(transcript, { height, fps }).video;
    expect(size(360, 10)).toBeLessThan(size(540, 15));
    expect(size(540, 15)).toBeLessThan(size(720, 25));
    expect(size(720, 25)).toBeLessThan(size(1080, 30));
  });
});
