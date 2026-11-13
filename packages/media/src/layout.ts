/**
 * Aufbau des Montagebilds, geteilt von ffmpeg, den Einblendungen, der Vorschau in der App
 * und der Resolve-Schnittliste. Ohne Node-Abhängigkeiten, damit die Oberfläche es nutzen kann.
 *
 * Das Video zeigt nur noch, was zum Zuordnen nötig ist: oben Uhrzeit, Einsatz und Montage-ID,
 * in der Mitte die laufenden Videos (gleichzeitige nebeneinander) mit ihrer Herkunft, unten
 * die laufenden Tonquellen. Fotos und Tagebuch stehen im Zeitgerüst, nicht im Video.
 */
export const W = 1280;
export const H = 720;
export const FPS = 25;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bereiche im Bild. */
export const LAYOUT = {
  top: { x: 0, y: 0, w: W, h: 52 },
  main: { x: 0, y: 52, w: W, h: 632 },
  bottom: { x: 0, y: 684, w: W, h: H - 684 },
} as const satisfies Record<string, Box>;

/** Höchstens so viele Videos gleichzeitig nebeneinander. */
export const MAX_TILES = 4;

/**
 * Felder für gleichzeitige Videos im Hauptfeld: eins füllt es, zwei stehen nebeneinander,
 * drei und vier im Raster 2 × 2. Maße gerade, damit ffmpeg sie ohne Rundung setzt.
 */
export function videoTiles(n: number): Box[] {
  const m = LAYOUT.main;
  if (n <= 1) return [{ ...m }];
  const w = Math.floor(m.w / 2 / 2) * 2;
  if (n === 2) {
    // 16:9 nebeneinander, senkrecht mittig.
    const h = Math.floor((w * 9) / 16 / 2) * 2;
    const y = m.y + Math.round((m.h - h) / 2);
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
