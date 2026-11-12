/**
 * Tonspur-Analyse: Lautstärke-Hüllkurve, Stille/Leerlauf, laute Stellen und
 * Versatz zwischen zwei Aufnahmen per Kreuzkorrelation.
 *
 * Alles arbeitet auf einer Hüllkurve mit 100 Werten pro Sekunde (10 ms). Ein
 * 8-Stunden-Feldtag sind so knapp 3 Mio. Werte, das passt bequem in den Speicher
 * und in die Projektdatei. FFmpeg dekodiert gestreamt, die Rohdaten werden nie
 * vollständig geladen.
 */
import { spawn } from "node:child_process";
import { toolPaths } from "./tools.ts";

/** Werte pro Sekunde in der Hüllkurve. */
export const ENVELOPE_RATE = 100;
const DECODE_RATE = 8000;
const SAMPLES_PER_FRAME = DECODE_RATE / ENVELOPE_RATE;
/** Untergrenze in dB, damit digitale Stille nicht −∞ ergibt. */
export const DB_FLOOR = -100;

export interface Envelope {
  rate: number;
  /** RMS-Pegel je 10 ms in dBFS (DB_FLOOR … 0). */
  db: Float32Array;
}

/** Hüllkurve einer Audio- oder Videodatei berechnen (erste Tonspur, auf Mono gemischt). */
export function computeEnvelope(path: string, opts: { signal?: AbortSignal } = {}): Promise<Envelope> {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      toolPaths().ffmpeg,
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        path,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(DECODE_RATE),
        "-f",
        "f32le",
        "-",
      ],
      { stdio: ["ignore", "pipe", "pipe"], ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    const out: number[] = [];
    let carry: Buffer = Buffer.alloc(0);
    let sumSq = 0;
    let n = 0;
    let err = "";
    ff.stdout.on("data", (chunk: Buffer) => {
      const buf: Buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const whole = buf.length - (buf.length % 4);
      for (let i = 0; i < whole; i += 4) {
        const v = buf.readFloatLE(i);
        sumSq += v * v;
        if (++n === SAMPLES_PER_FRAME) {
          out.push(toDb(Math.sqrt(sumSq / n)));
          sumSq = 0;
          n = 0;
        }
      }
      carry = buf.subarray(whole);
    });
    ff.stderr.on("data", (d: Buffer) => (err += d.toString()));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg (${code}): ${err.trim().split("\n")[0] ?? ""}`));
      if (n > 0) out.push(toDb(Math.sqrt(sumSq / n)));
      resolve({ rate: ENVELOPE_RATE, db: Float32Array.from(out) });
    });
  });
}

function toDb(rms: number): number {
  return rms > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(rms)) : DB_FLOOR;
}

/** Hüllkurve platzsparend speichern: 1 Byte je Wert, 0,4 dB Auflösung. */
export function packEnvelope(env: Envelope): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(env.db.length);
  for (let i = 0; i < env.db.length; i++) out[i] = Math.round(((env.db[i]! - DB_FLOOR) / -DB_FLOOR) * 250);
  return out;
}

export function unpackEnvelope(bytes: Uint8Array, rate = ENVELOPE_RATE): Envelope {
  const db = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) db[i] = (bytes[i]! / 250) * -DB_FLOOR + DB_FLOOR;
  return { rate, db };
}

function percentile(values: Float32Array, p: number): number {
  if (values.length === 0) return DB_FLOOR;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

// ── Leerlauf und laute Stellen ────────────────────────────────────────────

export interface Interval {
  startMs: number;
  endMs: number;
}

export interface LoudEvent {
  atMs: number;
  /** Wie weit über dem Grundrauschen, in dB. */
  aboveFloorDb: number;
}

export interface IdleAnalysis {
  /** Grundrauschen (10. Perzentil), in dBFS. */
  noiseFloorDb: number;
  /** Stille-Strecken ab der Mindestlänge, in ms ab Dateianfang. */
  idle: Interval[];
  /** Kurze laute Stellen innerhalb der Stille (Wachhund): Stimmen, Klatschen, Türen. */
  loudInIdle: LoudEvent[];
}

export interface IdleOptions {
  /** Stille zählt erst ab dieser Länge als Leerlauf. Konzept: 5 Minuten. */
  minIdleMs?: number;
  /** Schwelle über dem Grundrauschen, unter der es als still gilt. */
  silenceMarginDb?: number;
  /** Ab so viel über dem Grundrauschen gilt eine Stelle im Leerlauf als laut. */
  loudMarginDb?: number;
  /** Fenstergröße für die Entscheidung „hier passiert etwas“. */
  windowMs?: number;
  /** So viel Nicht-Stille muss in einem Fenster sein, damit es als aktiv zählt. */
  minActiveMs?: number;
}

/**
 * Leerlauf finden. Die Aufnahme wird in Fenster (5 s) geteilt; ein Fenster ist
 * aktiv, wenn darin mindestens 1 s lang etwas über dem Grundrauschen liegt.
 * Leerlauf sind lange Folgen inaktiver Fenster. Kurze Geräusche darin
 * (Klatschen, Türen, ein Wort) unterbrechen den Leerlauf nicht, werden aber als
 * laute Stellen gemeldet, damit nichts unbemerkt herausgeschnitten wird.
 */
export function detectIdle(env: Envelope, opts: IdleOptions = {}): IdleAnalysis {
  const minIdle = opts.minIdleMs ?? 5 * 60_000;
  const silenceMargin = opts.silenceMarginDb ?? 10;
  const loudMargin = opts.loudMarginDb ?? 20;
  const frameMs = 1000 / env.rate;
  const win = Math.max(1, Math.round((opts.windowMs ?? 5_000) / frameMs));
  const minActive = Math.max(1, Math.round((opts.minActiveMs ?? 1_000) / frameMs));
  const floor = percentile(env.db, 0.1);

  const windows = Math.ceil(env.db.length / win);
  const active = new Uint8Array(windows);
  for (let w = 0; w < windows; w++) {
    let loud = 0;
    for (let i = w * win; i < Math.min(env.db.length, (w + 1) * win); i++)
      if (env.db[i]! >= floor + silenceMargin) loud++;
    active[w] = loud >= minActive ? 1 : 0;
  }

  const idle: Interval[] = [];
  let start = -1;
  for (let w = 0; w <= windows; w++) {
    const quiet = w < windows && !active[w];
    if (quiet && start < 0) start = w;
    if (!quiet && start >= 0) {
      const startMs = Math.round(start * win * frameMs);
      const endMs = Math.round(Math.min(w * win, env.db.length) * frameMs);
      if (endMs - startMs >= minIdle) idle.push({ startMs, endMs });
      start = -1;
    }
  }

  const loudInIdle: LoudEvent[] = [];
  for (const iv of idle) {
    const a = Math.round(iv.startMs / frameMs);
    const b = Math.min(env.db.length, Math.round(iv.endMs / frameMs));
    let i = a;
    while (i < b) {
      if (env.db[i]! >= floor + loudMargin) {
        let peak = i;
        let j = i;
        while (j < b && env.db[j]! >= floor + loudMargin) {
          if (env.db[j]! > env.db[peak]!) peak = j;
          j++;
        }
        loudInIdle.push({ atMs: Math.round(peak * frameMs), aboveFloorDb: Math.round(env.db[peak]! - floor) });
        i = j + Math.round(1000 / frameMs); // Ereignisse mindestens 1 s auseinander
      } else i++;
    }
  }
  return { noiseFloorDb: Math.round(floor * 10) / 10, idle, loudInIdle };
}

// ── Versatz per Kreuzkorrelation ─────────────────────────────────────────

/**
 * Einsatz-Stärke: wie stark der Pegel gegenüber dem kurz davor ansteigt.
 * Klatschen, Silbenanfänge und Türen geben scharfe Spitzen, gleichmäßiges
 * Rauschen und unterschiedliche Mikrofonpegel fallen dabei heraus.
 */
export function onsetStrength(env: Envelope): Float32Array {
  const out = new Float32Array(env.db.length);
  // Anstiege unter ONSET_GATE_DB sind Rauschen und würden bei langen, stillen Aufnahmen die Spitzen überdecken.
  for (let i = 1; i < env.db.length; i++) out[i] = Math.max(0, env.db[i]! - env.db[i - 1]! - ONSET_GATE_DB);
  // Mittelwertfrei und normiert, damit die Korrelation zwischen −1 und 1 liegt.
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length || 1;
  let sq = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = out[i]! - mean;
    sq += out[i]! * out[i]!;
  }
  const norm = Math.sqrt(sq) || 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / norm;
  return out;
}

const ONSET_GATE_DB = 4;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place Radix-2-FFT. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}

/** corr[k] = Σ a[i + k] · b[i] für k = −(b.length−1) … a.length−1. */
function crossCorrelate(a: Float32Array, b: Float32Array): { values: Float64Array; zeroIndex: number } {
  const n = nextPow2(a.length + b.length);
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(a);
  br.set(b);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    // A · conj(B)
    const r = ar[i]! * br[i]! + ai[i]! * bi[i]!;
    const im = ai[i]! * br[i]! - ar[i]! * bi[i]!;
    ar[i] = r;
    ai[i] = im;
  }
  fft(ar, ai, true);
  const values = new Float64Array(a.length + b.length - 1);
  for (let k = -(b.length - 1); k < a.length; k++) values[k + b.length - 1] = ar[(k + n) % n]!;
  return { values, zeroIndex: b.length - 1 };
}

export interface OffsetEstimate {
  /** B beginnt so viele ms nach A (negativ = vor A). Es gilt: B bei t ≙ A bei t + lagMs. */
  lagMs: number;
  /** Höhe der Spitze, normiert (0 … 1). */
  score: number;
  /** Abstand der Spitze zur zweithöchsten Stelle (≥ 1; ab ca. 1,5 eindeutig). */
  distinctness: number;
}

export interface OffsetOptions {
  /** Erwarteter Versatz, falls bekannt (z. B. aus Metadaten). */
  expectedLagMs?: number;
  /** Nur ± so weit um den erwarteten Versatz suchen. */
  searchMs?: number;
}

/**
 * Versatz zwischen zwei Aufnahmen desselben Geschehens schätzen, über die
 * Einsatz-Stärken ihrer Hüllkurven. Genauigkeit ca. 10 ms (eine Hüllkurven-Stufe),
 * mit Parabel-Interpolation etwas besser.
 */
export function estimateOffset(a: Envelope, b: Envelope, opts: OffsetOptions = {}): OffsetEstimate | null {
  if (a.rate !== b.rate) throw new Error("Hüllkurven mit unterschiedlicher Rate");
  const frameMs = 1000 / a.rate;
  let offsetFrames = 0;
  let aEnv = a.db;
  // Bei bekanntem Versatz nur den passenden Ausschnitt von A ansehen: spart Zeit bei langen Aufnahmen.
  if (opts.expectedLagMs !== undefined && opts.searchMs !== undefined) {
    const from = Math.max(0, Math.floor((opts.expectedLagMs - opts.searchMs) / frameMs));
    const to = Math.min(a.db.length, Math.ceil((opts.expectedLagMs + opts.searchMs) / frameMs) + b.db.length);
    if (to - from < 2) return null;
    aEnv = a.db.subarray(from, to);
    offsetFrames = from;
  }
  const oa = onsetStrength({ rate: a.rate, db: aEnv });
  const ob = onsetStrength(b);
  if (oa.length < 2 || ob.length < 2) return null;
  const { values, zeroIndex } = crossCorrelate(oa, ob);

  let lo = 0;
  let hi = values.length - 1;
  if (opts.expectedLagMs !== undefined && opts.searchMs !== undefined) {
    const center = Math.round(opts.expectedLagMs / frameMs) - offsetFrames + zeroIndex;
    const w = Math.round(opts.searchMs / frameMs);
    lo = Math.max(0, center - w);
    hi = Math.min(values.length - 1, center + w);
  }
  let best = lo;
  for (let i = lo; i <= hi; i++) if (values[i]! > values[best]!) best = i;
  // Zweithöchste Spitze außerhalb von ±1 s um die beste.
  const guard = Math.round(1000 / frameMs);
  let second = 0;
  for (let i = lo; i <= hi; i++) if (Math.abs(i - best) > guard && values[i]! > second) second = values[i]!;

  // Parabel durch die Nachbarn für Bruchteile einer Stufe.
  let frac = 0;
  if (best > 0 && best < values.length - 1) {
    const y0 = values[best - 1]!;
    const y1 = values[best]!;
    const y2 = values[best + 1]!;
    const d = y0 - 2 * y1 + y2;
    if (d < 0) frac = (0.5 * (y0 - y2)) / d;
  }
  const lagFrames = best - zeroIndex + offsetFrames + frac;
  const score = Math.max(0, values[best]!);
  return {
    lagMs: Math.round(lagFrames * frameMs),
    score: Math.round(score * 1000) / 1000,
    distinctness: second > 0 ? Math.round((score / second) * 100) / 100 : 99,
  };
}

// ── Sync-Signale (Klatschen, Klappe) ─────────────────────────────────────

export interface Transient {
  atMs: number;
  /** Anstieg in dB innerhalb von 20 ms. */
  riseDb: number;
  peakDb: number;
}

/**
 * Scharfe, kurze Geräusche finden: schneller Anstieg, hohe Spitze, schnelles
 * Abklingen. Klatschen und Filmklappen sehen so aus, Sprache meist nicht,
 * weil sie langsamer ansteigt und anhält.
 */
export function detectTransients(
  env: Envelope,
  opts: { minRiseDb?: number; minAboveFloorDb?: number; minDecayDb?: number } = {},
): Transient[] {
  const minRise = opts.minRiseDb ?? 15;
  const minAbove = opts.minAboveFloorDb ?? 35;
  const minDecay = opts.minDecayDb ?? 10;
  const frameMs = 1000 / env.rate;
  const floor = percentile(env.db, 0.1);
  const decayFrames = Math.max(1, Math.round(150 / frameMs));
  const out: Transient[] = [];
  for (let i = 2; i < env.db.length - 1; i++) {
    const peak = env.db[i]!;
    if (peak < env.db[i - 1]! || peak < env.db[i + 1]!) continue;
    const rise = peak - Math.min(env.db[i - 1]!, env.db[i - 2]!);
    if (rise < minRise || peak < floor + minAbove) continue;
    let minAfter = peak;
    for (let j = i + 1; j <= Math.min(env.db.length - 1, i + decayFrames); j++)
      minAfter = Math.min(minAfter, env.db[j]!);
    if (peak - minAfter < minDecay) continue;
    const last = out.at(-1);
    if (last && i * frameMs - last.atMs < 300) continue;
    out.push({ atMs: Math.round(i * frameMs), riseDb: Math.round(rise), peakDb: Math.round(peak) });
  }
  return out;
}
