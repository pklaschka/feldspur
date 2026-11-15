import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { mergePeaks, peakLevel } from "@feldspur/core";
import { peakSampleRate, readPeaks } from "../src/waveform.ts";
import { hasFfmpeg } from "./fixtures.ts";

describe("Waveform-Skala", () => {
  it("logarithmisch: −60 dB und leiser = 0, Vollaussteuerung = 1, −30 dB = Mitte", () => {
    expect(peakLevel(0, "log")).toBe(0);
    expect(peakLevel(0.0005, "log")).toBe(0);
    expect(peakLevel(1, "log")).toBe(1);
    expect(peakLevel(-1, "log")).toBe(1);
    expect(peakLevel(10 ** (-30 / 20), "log")).toBeCloseTo(0.5, 5);
    expect(peakLevel(0.25, "linear")).toBe(0.25);
  });

  it("fasst Fächer zusammen", () => {
    const p = {
      fromMs: 0,
      toMs: 400,
      bucketMs: 100,
      min: Float32Array.from([-0.1, -0.5, 0, -0.2]),
      max: Float32Array.from([0.1, 0.2, 0.9, 0.3]),
      rms: Float32Array.from([0.1, 0.1, 0.1, 0.1]),
    };
    const m = mergePeaks(p, 2);
    expect([...m.min]).toEqual([-0.5, -0.2].map((v) => Math.fround(v)));
    expect([...m.max]).toEqual([0.2, 0.9].map((v) => Math.fround(v)));
    expect(m.bucketMs).toBe(200);
    expect(m.rms[0]).toBeCloseTo(0.1, 5);
  });

  it("dekodiert kurze Fenster fein, lange grob", () => {
    expect(peakSampleRate(120_000, 4000)).toBeGreaterThanOrEqual(1000);
    expect(peakSampleRate(10_000, 800)).toBe(4000);
    expect(peakSampleRate(8 * 3600_000, 1000)).toBe(500);
  });
});

describe.skipIf(!hasFfmpeg())("Waveform-Spitzen aus einer Datei", () => {
  let dir = "";
  let wav = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-wave-"));
    wav = join(dir, "ton.wav");
    // 2 s Stille, 1 s Ton (halbe Aussteuerung), 2 s Stille.
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.5*sin(2*PI*440*t)*between(t\\,2\\,3):s=16000:d=5",
      wav,
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("findet den Ton im richtigen Fach", async () => {
    const p = await readPeaks(wav, 0, 5000, 50);
    expect(p.max).toHaveLength(50);
    expect(p.bucketMs).toBe(100);
    expect(p.max[5]!).toBeLessThan(0.01);
    expect(p.max[25]!).toBeGreaterThan(0.45);
    expect(p.min[25]!).toBeLessThan(-0.45);
    expect(p.rms[25]!).toBeCloseTo(0.5 / Math.SQRT2, 1);
    expect(p.max[45]!).toBeLessThan(0.01);
  });

  it("liest nur den angefragten Ausschnitt", async () => {
    const p = await readPeaks(wav, 2500, 3500, 10);
    expect(p.fromMs).toBe(2500);
    expect(Math.max(...p.max.subarray(0, 5))).toBeGreaterThan(0.45);
    expect(Math.max(...p.max.subarray(6))).toBeLessThan(0.01);
  });

  it("lässt Fächer hinter dem Dateiende leer", async () => {
    const p = await readPeaks(wav, 4000, 6000, 20);
    expect(Math.max(...p.max.subarray(11))).toBe(0);
  });
});
