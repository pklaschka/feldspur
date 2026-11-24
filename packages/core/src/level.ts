/**
 * Lautstärke angleichen: Feldaufnahmen sind sehr unterschiedlich laut (Ansteckmikro direkt am Mund,
 * Kamera drei Meter weg). Jede Ton- und Videoquelle bekommt eine Verstärkung, damit Sprache in allen
 * etwa gleich laut ist, und auf Wunsch einen Kompressor, der leise Stellen näher an laute heranholt.
 *
 * Gilt beim Abhören in der App (Web Audio) und im Montagevideo (FFmpeg) mit denselben Werten.
 * Die Originaldateien bleiben unverändert. Ohne Node, damit die Oberfläche es direkt nutzen kann.
 *
 * Wer es benutzt: Die Tonspur-Analyse misst den Sprachpegel (`packages/media/src/analyze.ts`), die Oberfläche hört
 * damit ab (`apps/desktop/src/renderer/level.ts`), die Montage baut daraus die FFmpeg-Filter
 * (`packages/media/src/audio.ts`). Die Einstellung je Quelle steht in `Source.levelMode`, `levelGainDb` und
 * `levelCompress` (`packages/core/src/model.ts`).
 */

/** Sprachpegel, auf den „automatisch“ angleicht (dBFS, Mittel über die lauten Stellen). */
export const LEVEL_TARGET_DB = -20;
/** Grenzen der automatischen Verstärkung: sehr leise Aufnahmen nicht ins Rauschen hochziehen. */
export const LEVEL_MAX_BOOST_DB = 30;
/** Gegenstück: sehr laute Aufnahmen höchstens um so viel absenken. */
export const LEVEL_MAX_CUT_DB = -20;
/** Grenzen für „von Hand“. */
export const LEVEL_MANUAL_RANGE_DB = [-30, 40] as const;

/**
 * Kompressor „leise Stellen anheben“. Werte für Web Audio (DynamicsCompressorNode) und FFmpeg
 * (acompressor) gleich gewählt. Über der Schwelle wird der Pegel im Verhältnis 1:ratio gedämpft, die
 * Aufholverstärkung hebt danach alles wieder an: leise Sprecher*innen rücken näher an laute heran.
 *
 * Die Aufholverstärkung folgt der Formel, die Web Audio fest eingebaut hat (Spezifikation:
 * (1 / Verstärkung bei 0 dBFS)^0,6). FFmpeg bekommt sie ausdrücklich, damit beides gleich klingt.
 */
export const COMPRESSOR = {
  thresholdDb: -32,
  ratio: 4,
  kneeDb: 8,
  attackMs: 5,
  releaseMs: 250,
  /** 0,6 · |Schwelle| · (1 − 1/ratio), wie Web Audio sie selbst anwendet. */
  makeupDb: Math.round(0.6 * 32 * (1 - 1 / 4) * 10) / 10,
} as const;
/** Begrenzer am Ende, damit verstärkte Spitzen nicht übersteuern. */
export const LIMIT_DB = -1;

/** „auto“ = auf den gemeinsamen Sprachpegel angleichen, „manual“ = von Hand, „off“ = Ton unverändert. */
export type LevelMode = "auto" | "manual" | "off";

/** Lautstärke-Einstellung einer Quelle; dieselben drei Felder wie an `Source`. */
export interface LevelSetting {
  levelMode: LevelMode;
  /** Nur bei „von Hand“. */
  levelGainDb: number;
  levelCompress: boolean;
}

/**
 * Sprachpegel aus der Hüllkurve (dBFS je 10 ms): angelehnt an EBU R 128 mit zwei Schwellen. Erst
 * fallen Stille und Rauschen weg (unter −60 dBFS), dann alles mehr als 15 dB unter dem Mittel der
 * übrigen. Das Mittel der Leistung, die bleibt, ist der Pegel, mit dem gesprochen wurde. Lange
 * Pausen ändern ihn deshalb kaum. null, wenn nichts hörbar ist.
 */
export function speechLevelDb(db: ArrayLike<number>): number | null {
  const absGate = -60;
  // Gemittelt wird die Leistung (10^(dB/10)), nicht der dB-Wert.
  let sum = 0;
  let n = 0;
  for (let i = 0; i < db.length; i++) {
    const v = db[i]!;
    if (v > absGate) {
      sum += 10 ** (v / 10);
      n++;
    }
  }
  if (!n) return null;
  const relGate = 10 * Math.log10(sum / n) - 15;
  let sum2 = 0;
  let n2 = 0;
  for (let i = 0; i < db.length; i++) {
    const v = db[i]!;
    if (v > absGate && v > relGate) {
      sum2 += 10 ** (v / 10);
      n2++;
    }
  }
  return Math.round(10 * Math.log10(sum2 / n2) * 10) / 10;
}

/** Verstärkung in dB, die für eine Quelle gilt. measuredDb = Sprachpegel, null = noch nicht gemessen. */
export function effectiveGainDb(level: LevelSetting, measuredDb: number | null): number {
  if (level.levelMode === "off") return 0;
  if (level.levelMode === "manual") {
    const [lo, hi] = LEVEL_MANUAL_RANGE_DB;
    return Math.min(hi, Math.max(lo, level.levelGainDb));
  }
  // Automatisch, aber noch nicht gemessen: nichts verstellen, bis die Analyse gelaufen ist.
  if (measuredDb === null) return 0;
  const g = LEVEL_TARGET_DB - measuredDb;
  return Math.round(Math.min(LEVEL_MAX_BOOST_DB, Math.max(LEVEL_MAX_CUT_DB, g)) * 10) / 10;
}

/** Ob überhaupt bearbeitet wird (sonst Ton unverändert durchreichen). */
export function levelActive(level: LevelSetting, gainDb: number): boolean {
  return level.levelMode !== "off" && (gainDb !== 0 || level.levelCompress);
}

/** dB → Faktor für die Amplitude (+6 dB ≈ doppelt). */
export const dbToGain = (db: number) => 10 ** (db / 20);
