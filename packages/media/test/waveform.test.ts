/**
 * Waveform für die Oberfläche: Skala der Spitzen (`packages/core/src/waveform.ts`) und Spitzen aus einer
 * Datei lesen (`packages/media/src/waveform.ts`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { mergePeaks, peakLevel } from "@feldspur/core";
import { peakSampleRate, readPeaks } from "../src/waveform.ts";
import { hasFfmpeg } from "./fixtures.ts";

describe("Waveform-Skala", () => {
  it.each`
    spitze              | skala       | hoehe   | was
    ${0}                | ${"log"}    | ${0}    | ${"Stille"}
    ${0.0005}           | ${"log"}    | ${0}    | ${"leiser als −60 dB"}
    ${1}                | ${"log"}    | ${1}    | ${"Vollaussteuerung"}
    ${-1}               | ${"log"}    | ${1}    | ${"Vollaussteuerung negativ"}
    ${10 ** (-30 / 20)} | ${"log"}    | ${0.5}  | ${"−30 dB"}
    ${0.25}             | ${"linear"} | ${0.25} | ${"linear unverändert"}
  `("$was ($skala) zeichnet Höhe $hoehe", ({ spitze, skala, hoehe }) => {
    expect(peakLevel(spitze, skala)).toBeCloseTo(hoehe, 5);
  });

  it("fasst je zwei Fächer zusammen: Minimum, Maximum und mittlerer Pegel", () => {
    // Angenommen: vier Fächer zu je 100 ms
    const p = {
      fromMs: 0,
      toMs: 400,
      bucketMs: 100,
      min: Float32Array.from([-0.1, -0.5, 0, -0.2]),
      max: Float32Array.from([0.1, 0.2, 0.9, 0.3]),
      rms: Float32Array.from([0.1, 0.1, 0.1, 0.1]),
    };
    // Wenn: je zwei zusammengefasst werden
    const m = mergePeaks(p, 2);
    // Dann: zwei Fächer zu 200 ms mit den Extremen beider
    expect([...m.min]).toEqual([-0.5, -0.2].map((v) => Math.fround(v)));
    expect([...m.max]).toEqual([0.2, 0.9].map((v) => Math.fround(v)));
    expect(m.bucketMs).toBe(200);
    expect(m.rms[0]).toBeCloseTo(0.1, 5);
  });

  it("dekodiert kurze Fenster fein, lange grob", () => {
    // Zwei Minuten auf 4000 Fächern: mindestens 1000 Hz; 10 s: 4000 Hz; acht Stunden: 500 Hz
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
    // Wenn: 5 s in 50 Fächern gelesen werden (Ton von 2 bis 3 s)
    const p = await readPeaks(wav, 0, 5000, 50);
    // Dann: still vor und nach dem Ton, laut im Fach bei 2,5 s
    expect(p.max).toHaveLength(50);
    expect(p.bucketMs).toBe(100);
    expect(p.max[5]!).toBeLessThan(0.01);
    expect(p.max[25]!).toBeGreaterThan(0.45);
    expect(p.min[25]!).toBeLessThan(-0.45);
    expect(p.rms[25]!).toBeCloseTo(0.5 / Math.SQRT2, 1);
    expect(p.max[45]!).toBeLessThan(0.01);
  });

  it("liest nur den angefragten Ausschnitt", async () => {
    // Wenn: nur 2,5 bis 3,5 s gelesen werden
    const p = await readPeaks(wav, 2500, 3500, 10);
    // Dann: Ton in der ersten Hälfte, Stille danach
    expect(p.fromMs).toBe(2500);
    expect(Math.max(...p.max.subarray(0, 5))).toBeGreaterThan(0.45);
    expect(Math.max(...p.max.subarray(6))).toBeLessThan(0.01);
  });

  it("lässt Fächer hinter dem Dateiende leer", async () => {
    // Wenn: über das Dateiende (5 s) hinaus gelesen wird
    const p = await readPeaks(wav, 4000, 6000, 20);
    // Dann: bleiben die Fächer danach leer
    expect(Math.max(...p.max.subarray(11))).toBe(0);
  });
});
