/**
 * Lautstärke-Angleichung (FFmpeg-Filter) und Einrasten beim Feinabgleich, mit erfundenen,
 * von FFmpeg erzeugten Tönen.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { speechLevelDb } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { bestLag, refineAlignment } from "../src/align.ts";
import { computeEnvelope, levelFilter } from "../src/audio.ts";
import { hasFfmpeg } from "./fixtures.ts";

const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
let dir: string;

/**
 * „Sprache“: Rauschen, das in unregelmäßigen Silben an- und abschwillt (gleicher Zufallsstart =
 * gleiches Muster). delay verschiebt den Inhalt nach hinten, volume macht leiser.
 */
function speech(path: string, opts: { delayMs?: number; volumeDb?: number; seconds?: number } = {}) {
  const sec = opts.seconds ?? 12;
  const gate = "if(gt(sin(2*PI*t*2.3)+sin(2*PI*t*3.7+1)+sin(2*PI*t*0.9+2),0.6),1,0.03)";
  ff(
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=d=${sec}:c=pink:r=16000:a=0.5:seed=7`,
    "-af",
    [
      `volume='${gate}':eval=frame`,
      `adelay=${opts.delayMs ?? 0}:all=1`,
      `volume=${opts.volumeDb ?? 0}dB`,
      `atrim=0:${sec}`,
    ].join(","),
    "-ar",
    "16000",
    path,
  );
}

const run = hasFfmpeg() ? describe : describe.skip;

run("Lautstärke angleichen mit FFmpeg", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-level-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("hebt eine leise Aufnahme auf den Zielpegel", async () => {
    const quiet = join(dir, "leise.wav");
    speech(quiet, { volumeDb: -24 });
    const before = speechLevelDb((await computeEnvelope(quiet)).db)!;
    expect(before).toBeLessThan(-30);
    const out = join(dir, "angeglichen.wav");
    const gainDb = -20 - before;
    ff("-i", quiet, "-af", levelFilter({ gainDb, compress: false }), out);
    expect(speechLevelDb((await computeEnvelope(out)).db)!).toBeCloseTo(-20, 0);
    const comp = join(dir, "kompressor.wav");
    ff("-i", quiet, "-af", levelFilter({ gainDb, compress: true }), comp);
    const after = speechLevelDb((await computeEnvelope(comp)).db)!;
    expect(Math.abs(after - -20)).toBeLessThan(2);
  });

  it("begrenzt Spitzen nach starker Verstärkung", async () => {
    const loud = join(dir, "laut.wav");
    speech(loud, { volumeDb: 0 });
    const out = join(dir, "begrenzt.wav");
    ff("-i", loud, "-af", levelFilter({ gainDb: 20, compress: false }), out);
    const env = await computeEnvelope(out);
    expect(Math.max(...env.db)).toBeLessThanOrEqual(-0.5);
  });
});

run("Einrasten", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-align-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("findet die genaue Lage, auch bei anderem Pegel", async () => {
    const a = join(dir, "a.wav");
    const b = join(dir, "b.wav");
    speech(a);
    // Dasselbe Geschehen, 1,234 s später auf dem zweiten Gerät, 18 dB leiser.
    speech(b, { delayMs: 1234, volumeDb: -18 });
    // Grob gezogen: 180 ms daneben.
    const r = await refineAlignment({ aPath: a, aAtMs: 5000, bPath: b, bAtMs: 5000 + 1234 + 180, searchMs: 600 });
    expect(r).not.toBeNull();
    expect(Math.abs(r!.bAtMs - 6234)).toBeLessThanOrEqual(4);
    expect(r!.distinctness).toBeGreaterThan(1.2);
  });

  it("kommt nahe am Dateianfang zurecht", async () => {
    const a = join(dir, "a2.wav");
    const b = join(dir, "b2.wav");
    speech(a, { delayMs: 3000 });
    speech(b, { delayMs: 200 });
    const r = await refineAlignment({ aPath: a, aAtMs: 3400, bPath: b, bAtMs: 700, searchMs: 1500 });
    expect(Math.abs(r!.bAtMs - 600)).toBeLessThanOrEqual(4);
  });

  it("bestLag: verschobene Folge", () => {
    const a = Float32Array.from({ length: 400 }, (_, i) => (Math.sin(i * 0.37) + Math.sin(i * 0.11) > 0.8 ? -20 : -60));
    const b = new Float32Array(600).fill(-60);
    b.set(a, 100 + 37);
    expect(bestLag(a, b, 100)!.lag).toBe(37);
  });
});
