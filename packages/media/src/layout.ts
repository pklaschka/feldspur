/**
 * Aufbau des Montagebilds, geteilt von ffmpeg, den Einblendungen, der Vorschau in der App
 * und der Resolve-Schnittliste. Ohne Node-Abhängigkeiten, damit die Oberfläche es nutzen kann.
 *
 * Das Video zeigt nur noch, was zum Zuordnen nötig ist: oben Uhrzeit, Einsatz und Montage-ID,
 * in der Mitte die laufenden Videos (gleichzeitige nebeneinander) mit ihrer Herkunft, unten
 * die laufenden Tonquellen. Fotos und Tagebuch stehen im Einsatztranskript, nicht im Video.
 *
 * Einordnung: Schritt „Ausgeben“. Benutzt von `packages/media/src/montage-video.ts` (ffmpeg),
 * `packages/media/src/fcpxml.ts` (Resolve-Schnittliste) und, über `@feldspur/media/layout`, von der Oberfläche:
 * `apps/desktop/src/renderer/overlay.ts` (Einblendungen) und `apps/desktop/src/renderer/MontageView.tsx` (Vorschau).
 * Wer hier Maße ändert, ändert alle vier zugleich.
 *
 * Auflösung und Bildrate sind wählbar (Issue #250, `MontageFormat`): Alle Maße entstehen aus `montageLayout`.
 */
/** Wählbare Bildhöhen des Montagevideos (Issue #250); die Breite folgt im Verhältnis 16:9. */
export const RESOLUTIONS = [360, 540, 720, 1080] as const;
/** Wählbare Bildraten des Montagevideos, in Bildern je Sekunde (Issue #250). */
export const FRAME_RATES = [10, 15, 25, 30] as const;

/** Auflösung und Bildrate des Montagevideos; gilt je Projekt und wird in der Projektdatei gemerkt. */
export interface MontageFormat {
  /** Bildhöhe in Pixeln, eine aus `RESOLUTIONS`. */
  height: number;
  /** Bilder je Sekunde, eine aus `FRAME_RATES`; daran hängen auch die Grenzen der Stücke (`Piece.f0`/`f1`). */
  fps: number;
}

/** Wie bisher: 1280 × 720 bei 25 Bildern je Sekunde. */
export const DEFAULT_FORMAT: MontageFormat = { height: 720, fps: 25 };

/** Ein gespeicherter oder übergebener Wert als gültiges Format; Unbekanntes fällt je Teil auf den Standard zurück. */
export function montageFormat(value: unknown): MontageFormat {
  const v = (value ?? {}) as Partial<Record<keyof MontageFormat, unknown>>;
  const pick = (list: readonly number[], x: unknown, fallback: number) =>
    typeof x === "number" && list.includes(x) ? x : fallback;
  return {
    height: pick(RESOLUTIONS, v.height, DEFAULT_FORMAT.height),
    fps: pick(FRAME_RATES, v.fps, DEFAULT_FORMAT.fps),
  };
}

/** Ist das der Standard? Dann bleibt alles, was davon abhängt (Zwischenspeicher, Schätzung), wie vor Issue #250. */
export const isDefaultFormat = (f: MontageFormat): boolean =>
  f.height === DEFAULT_FORMAT.height && f.fps === DEFAULT_FORMAT.fps;

/** Breite zu einer Bildhöhe (16:9, gerade). */
export const widthOf = (height: number): number => Math.round((height * 16) / 9 / 2) * 2;

/** „1280 × 720, 25 Bilder/s“: so steht das Format in der LIESMICH und im Vergleich „damals …, jetzt …“. */
export const formatText = (f: MontageFormat): string => `${widthOf(f.height)} × ${f.height}, ${f.fps} Bilder/s`;

/** Rechteck im Montagebild, in Pixeln ab der linken oberen Ecke. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Aufbau des Bilds in einem Format: Maße, Bildrate, Bereiche und der Maßstab für Schrift und Leisten. */
export interface MontageLayout {
  /** Breite und Höhe des Montagebilds in Pixeln. */
  w: number;
  h: number;
  fps: number;
  /**
   * Maßstab für Schrift, Leisten und Abstände, bezogen auf 1280 × 720 (dort 1). Unter 720 schrumpft er nicht so weit
   * wie das Bild, sonst würden Uhrzeit und Montage-ID unlesbar; über 720 wächst er mit.
   */
  u: number;
  /** Kopfzeile (`top`), Hauptfeld für die Videos (`main`), Fußzeile für den Ton (`bottom`). */
  top: Box;
  main: Box;
  bottom: Box;
}

/** Kleinster Maßstab für Schrift und Leisten: Bei 640 × 360 steht die Montage-ID damit noch in gut 11 Pixeln. */
const MIN_U = 0.8;
const even = (n: number) => Math.round(n / 2) * 2;

/** Aufbau des Montagebilds im Format `f`; im Standardformat genau wie vor Issue #250. */
export function montageLayout(f: MontageFormat = DEFAULT_FORMAT): MontageLayout {
  const h = f.height;
  const w = widthOf(h);
  const u = Math.max(MIN_U, h / 720);
  // Höhen gerade, damit ffmpeg die Felder ohne Rundung setzt (yuv420p).
  const top = even(52 * u);
  const bottom = even(36 * u);
  return {
    w,
    h,
    fps: f.fps,
    u,
    top: { x: 0, y: 0, w, h: top },
    main: { x: 0, y: top, w, h: h - top - bottom },
    bottom: { x: 0, y: h - bottom, w, h: bottom },
  };
}

/** Höchstens so viele Videos gleichzeitig nebeneinander. */
export const MAX_TILES = 4;

/**
 * Felder für gleichzeitige Videos im Hauptfeld: eins füllt es, zwei stehen nebeneinander,
 * drei und vier im Raster 2 × 2. Maße gerade, damit ffmpeg sie ohne Rundung setzt.
 */
export function videoTiles(n: number, layout: MontageLayout = montageLayout()): Box[] {
  const m = layout.main;
  if (n <= 1) return [{ ...m }];
  const w = Math.floor(m.w / 2 / 2) * 2;
  if (n === 2) {
    // 16:9 nebeneinander, senkrecht mittig.
    const h = Math.floor((w * 9) / 16 / 2) * 2;
    const y = m.y + even((m.h - h) / 2);
    return [
      { x: m.x, y, w, h },
      { x: m.x + w, y, w, h },
    ];
  }
  const h = Math.floor(m.h / 2 / 2) * 2;
  return Array.from({ length: Math.min(n, MAX_TILES) }, (_, i) => ({
    x: m.x + (i % 2) * w,
    y: m.y + Math.floor(i / 2) * h,
    w,
    h,
  }));
}
