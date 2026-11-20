/**
 * Waveform-Spitzen für einen Ausschnitt einer Ton- oder Videodatei. FFmpeg dekodiert nur das
 * angefragte Fenster (Sprung per -ss vor der Eingabe), auf Mono gemischt. Gedacht für Ansichten,
 * die Ausschnitte zeigen (Mitschreiben, Feinabgleich); die Hüllkurve der ganzen Datei liefert die
 * Tonspur-Analyse (audio.ts).
 */
import type { Peaks } from "@feldspur/core";
import { runTool, STALL_MS } from "./process.ts";

export type { Peaks } from "@feldspur/core";

/** Höchstens so viele Fächer je Anfrage. */
export const MAX_PEAK_BUCKETS = 8192;

/**
 * Abtastrate fürs Dekodieren: genug Werte je Fach, damit Spitzen stimmen, aber bei langen
 * Fenstern grob genug, dass es zügig geht.
 */
export function peakSampleRate(windowMs: number, buckets: number): number {
  const sec = Math.max(0.001, windowMs / 1000);
  const wanted = Math.ceil((buckets * 32) / sec);
  const lo = sec > 600 ? 500 : 4000;
  return Math.min(16_000, Math.max(lo, wanted));
}

export async function readPeaks(
  path: string,
  fromMs: number,
  toMs: number,
  buckets: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Peaks> {
  const from = Math.max(0, Math.round(fromMs));
  const to = Math.max(from + 1, Math.round(toMs));
  const n = Math.max(1, Math.min(MAX_PEAK_BUCKETS, Math.round(buckets)));
  const rate = peakSampleRate(to - from, n);
  const total = Math.max(1, Math.round(((to - from) / 1000) * rate));
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  const sq = new Float64Array(n);
  const count = new Uint32Array(n);
  let carry: Buffer = Buffer.alloc(0);
  let i = 0;
  await runTool(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-ss",
      (from / 1000).toFixed(3),
      "-t",
      ((to - from) / 1000).toFixed(3),
      "-i",
      path,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(rate),
      "-f",
      "f32le",
      "-",
    ],
    {
      signal: opts.signal,
      idleTimeoutMs: STALL_MS,
      onStdout: (chunk) => {
        const buf: Buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        const whole = buf.length - (buf.length % 4);
        for (let o = 0; o < whole; o += 4, i++) {
          if (i >= total) break;
          const v = buf.readFloatLE(o);
          const b = Math.min(n - 1, Math.floor((i * n) / total));
          if (v < min[b]!) min[b] = v;
          if (v > max[b]!) max[b] = v;
          sq[b] = sq[b]! + v * v;
          count[b] = count[b]! + 1;
        }
        carry = buf.subarray(whole);
      },
    },
  );
  const rms = new Float32Array(n);
  for (let b = 0; b < n; b++) rms[b] = count[b] ? Math.sqrt(sq[b]! / count[b]!) : 0;
  return { fromMs: from, toMs: to, bucketMs: (to - from) / n, min, max, rms };
}
