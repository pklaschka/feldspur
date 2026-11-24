/**
 * Feinabgleich zweier Tonspuren an einer markanten Stelle. Die Forschenden setzen die Stellen grob
 * (Waveforms übereinander ziehen); „Einrasten“ sucht dann in einem kleinen Fenster die Lage, in der
 * beide Aufnahmen am besten übereinstimmen. Auflösung 2 ms, also deutlich feiner als die Hüllkurve
 * der Tonspur-Analyse (10 ms).
 *
 * Einordnung: Schritt Abgleichen, beim Setzen eines Ankers (`SyncAnchor`) von Hand. Die Oberfläche
 * (`apps/desktop/src/renderer/FineAlign.tsx`) ruft über IPC `alignRefine` den Main-Prozess
 * (`apps/desktop/src/main/ipc/sync.ts`), der `refineAlignment` aufruft. Gelesen wird direkt aus den
 * Originaldateien (`readPeaks`, `packages/media/src/waveform.ts`), nicht aus der gespeicherten Hüllkurve.
 */
import { readPeaks } from "./waveform.ts";

/** Fächerbreite fürs Einrasten. */
export const ALIGN_FRAME_MS = 2;

/** Ergebnis von `bestLag`. */
export interface LagEstimate {
  /** Verschiebung von B in Fächern: B[i + lag] passt zu A[i]. */
  lag: number;
  /** Übereinstimmung an der besten Lage (normierte Korrelation, 0 … 1). */
  score: number;
  /** Beste Lage geteilt durch die zweitbeste, die mindestens 50 ms entfernt liegt; 99 = keine zweite. */
  distinctness: number;
}

/** Pegel in dB, Stille auf −80 dB gekappt. */
function toDb(rms: Float32Array): Float32Array {
  const out = new Float32Array(rms.length);
  for (let i = 0; i < rms.length; i++) out[i] = rms[i]! > 1e-4 ? 20 * Math.log10(rms[i]!) : -80;
  return out;
}

/**
 * Merkmal für den Vergleich: Anstieg des Pegels über 10 ms (Silbenanfänge, Klatscher, Türen) plus
 * ein kleiner Anteil des Pegels selbst. Anstiege hängen kaum davon ab, wie laut ein Mikrofon
 * eingestellt ist oder wie weit es weg war; das macht Aufnahmen verschiedener Geräte vergleichbar.
 */
function feature(db: Float32Array, step = 5): Float32Array {
  const out = new Float32Array(db.length);
  for (let i = 0; i < db.length; i++) {
    const rise = i >= step ? Math.max(0, db[i]! - db[i - step]!) : 0;
    out[i] = rise + 0.1 * (db[i]! + 80);
  }
  return out;
}

/**
 * Beste Verschiebung von b gegenüber a suchen, mit normierter Kreuzkorrelation je Verschiebung.
 * b muss auf beiden Seiten maxLag Fächer länger sein als a; lag = 0 heißt: b[i + maxLag] ≙ a[i].
 */
export function bestLag(aDb: Float32Array, bDb: Float32Array, maxLag: number): LagEstimate | null {
  const fa = feature(aDb);
  const fb = feature(bDb);
  const n = fa.length;
  if (n < 10 || fb.length < n + 2 * maxLag) return null;
  let meanA = 0;
  for (const v of fa) meanA += v;
  meanA /= n;
  let normA = 0;
  const za = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    za[i] = fa[i]! - meanA;
    normA += za[i]! * za[i]!;
  }
  normA = Math.sqrt(normA);
  if (normA === 0) return null;

  // Laufende Summen für Mittel und Länge jedes b-Ausschnitts.
  const pre = new Float64Array(fb.length + 1);
  const pre2 = new Float64Array(fb.length + 1);
  for (let i = 0; i < fb.length; i++) {
    pre[i + 1] = pre[i]! + fb[i]!;
    pre2[i + 1] = pre2[i]! + fb[i]! * fb[i]!;
  }
  const scores = new Float64Array(2 * maxLag + 1);
  for (let l = -maxLag; l <= maxLag; l++) {
    const off = l + maxLag;
    const sum = pre[off + n]! - pre[off]!;
    const sum2 = pre2[off + n]! - pre2[off]!;
    const varB = sum2 - (sum * sum) / n;
    if (varB <= 0) continue;
    let dot = 0;
    for (let i = 0; i < n; i++) dot += za[i]! * fb[off + i]!;
    // za ist mittelwertfrei, deshalb fällt das Mittel von b im Skalarprodukt heraus.
    scores[off] = dot / (normA * Math.sqrt(varB));
  }
  let best = 0;
  for (let k = 1; k < scores.length; k++) if (scores[k]! > scores[best]!) best = k;
  // Zweitbeste Lage mindestens 50 ms entfernt.
  const guard = Math.round(50 / ALIGN_FRAME_MS);
  let second = 0;
  for (let k = 0; k < scores.length; k++) if (Math.abs(k - best) > guard && scores[k]! > second) second = scores[k]!;
  const score = Math.max(0, scores[best]!);
  return {
    lag: best - maxLag,
    score: Math.round(score * 1000) / 1000,
    distinctness: second > 0 ? Math.round((score / second) * 100) / 100 : 99,
  };
}

/** Zwei grob gesetzte Stellen (ms ab Dateianfang) in den Originaldateien A und B. */
export interface RefineInput {
  aPath: string;
  aAtMs: number;
  bPath: string;
  bAtMs: number;
  /** So weit um bAtMs suchen (ms, Standard 1500). */
  searchMs?: number;
  /** So viel um die Stelle in A wird verglichen (je Seite, in ms, Standard 4000). */
  windowMs?: number;
}

/**
 * Stelle in B suchen, die am besten zur Stelle in A passt. null, wenn nichts Vergleichbares da ist.
 * A bleibt, wo es ist; zurück kommt die verschobene Stelle in B (ms ab Dateianfang) mit Güte wie in `LagEstimate`.
 */
export async function refineAlignment(
  input: RefineInput,
): Promise<{ bAtMs: number; score: number; distinctness: number } | null> {
  const f = (ms: number) => Math.floor(ms / ALIGN_FRAME_MS) * ALIGN_FRAME_MS;
  // Nahe am Dateianfang (Klatscher gleich nach dem Einschalten): Suche und Fenster nach vorn kürzen.
  const search = f(Math.min(input.searchMs ?? 1500, Math.max(0, input.bAtMs)));
  const win = input.windowMs ?? 4000;
  const lead = f(Math.max(0, Math.min(win, input.aAtMs, input.bAtMs - search)));
  const aFrom = input.aAtMs - lead;
  const aTo = input.aAtMs + win;
  const bFrom = input.bAtMs - lead - search;
  const aBuckets = Math.round((aTo - aFrom) / ALIGN_FRAME_MS);
  const bSpan = aTo - aFrom + 2 * search;
  const [a, b] = await Promise.all([
    readPeaks(input.aPath, aFrom, aTo, aBuckets),
    readPeaks(input.bPath, bFrom, bFrom + bSpan, Math.round(bSpan / ALIGN_FRAME_MS)),
  ]);
  const est = bestLag(toDb(a.rms), toDb(b.rms), Math.round(search / ALIGN_FRAME_MS));
  if (!est) return null;
  return {
    bAtMs: Math.round(input.bAtMs + est.lag * ALIGN_FRAME_MS),
    score: est.score,
    distinctness: est.distinctness,
  };
}
