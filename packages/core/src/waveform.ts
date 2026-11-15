/**
 * Waveform-Darstellung ohne Node-Abhängigkeiten, damit Oberfläche und Hauptprozess dieselbe
 * Skala benutzen. Die Spitzen selbst liest `readPeaks` in @feldspur/media.
 */

/** Spitzen eines Ausschnitts: je Fach kleinster, größter Abtastwert und RMS (Abtastwerte −1 … 1). */
export interface Peaks {
  /** Beginn des Ausschnitts in ms ab Dateianfang. */
  fromMs: number;
  /** Ende des Ausschnitts (wie angefragt; hinter dem Dateiende sind die Fächer leer). */
  toMs: number;
  /** Breite eines Fachs in ms. */
  bucketMs: number;
  min: Float32Array;
  max: Float32Array;
  rms: Float32Array;
}

export type WaveformScale = "linear" | "log";

/** Untergrenze der logarithmischen Skala: leiser als das zählt als Stille. */
export const WAVEFORM_FLOOR_DB = -60;

/**
 * Betrag eines Abtastwerts (0 … 1) auf die Anzeigehöhe 0 … 1 abbilden. Logarithmisch zeigt leise
 * Sprache deutlich, statt neben einem lauten Klatscher zu verschwinden.
 */
export function peakLevel(v: number, scale: WaveformScale, floorDb = WAVEFORM_FLOOR_DB): number {
  const a = Math.min(1, Math.abs(v));
  if (scale === "linear") return a;
  if (a <= 0) return 0;
  const db = 20 * Math.log10(a);
  return db <= floorDb ? 0 : 1 - db / floorDb;
}

/** Spitzen auf weniger Fächer zusammenfassen, z. B. für eine gröbere Ansicht. */
export function mergePeaks(p: Peaks, buckets: number): Peaks {
  const n = p.max.length;
  const out = {
    fromMs: p.fromMs,
    toMs: p.toMs,
    bucketMs: (p.toMs - p.fromMs) / buckets,
    min: new Float32Array(buckets),
    max: new Float32Array(buckets),
    rms: new Float32Array(buckets),
  };
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor((b * n) / buckets);
    const e = Math.max(a + 1, Math.floor(((b + 1) * n) / buckets));
    let lo = 0;
    let hi = 0;
    let sq = 0;
    for (let i = a; i < Math.min(e, n); i++) {
      lo = Math.min(lo, p.min[i]!);
      hi = Math.max(hi, p.max[i]!);
      sq += p.rms[i]! * p.rms[i]!;
    }
    out.min[b] = lo;
    out.max[b] = hi;
    out.rms[b] = Math.sqrt(sq / (e - a));
  }
  return out;
}
