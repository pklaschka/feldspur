/**
 * Aufbau des Montagebilds, geteilt von ffmpeg, den Einblendungen, der Vorschau in der App
 * und der Resolve-Schnittliste. Ohne Node-Abhängigkeiten, damit die Oberfläche es nutzen kann.
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
  main: { x: 0, y: 52, w: 944, h: 531 },
  side: { x: 944, y: 52, w: W - 944, h: 531 },
  bottom: { x: 0, y: 583, w: W, h: H - 583 },
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
  const h = Math.floor(m.h / 2 / 2) * 2;
  if (n === 2) {
    const y = m.y + Math.round((m.h - h) / 2);
    return [
      { x: m.x, y, w, h },
      { x: m.x + w, y, w, h },
    ];
  }
  return Array.from({ length: Math.min(n, MAX_TILES) }, (_, i) => ({
    x: m.x + (i % 2) * w,
    y: m.y + Math.floor(i / 2) * h,
    w,
    h,
  }));
}

/** Höhe für Text unter dem Standbild in der Seitenspalte (Tagebuch-Abschrift). */
export const SIDE_TEXT_H = 220;
/** Höhe der Bildunterschrift unten in der Seitenspalte. */
export const SIDE_CAPTION_H = 32;

/**
 * Wo das Standbild steht: in Episoden in der Seitenspalte (mit Platz für Text darunter, falls es
 * welchen gibt), bei Tafeln groß im Hauptfeld.
 */
export function stillBox(kind: "episode" | "card" | "item", withText: boolean): Box {
  if (kind === "episode") {
    const s = LAYOUT.side;
    const below = SIDE_CAPTION_H + (withText ? SIDE_TEXT_H : 0) + 8;
    return { x: s.x + 8, y: s.y + 8, w: s.w - 16, h: s.h - 8 - below };
  }
  // Tafeln: unten bleibt Platz für die dreizeilige Beschreibung.
  const m = LAYOUT.main;
  return { x: m.x + 8, y: m.y + 8, w: m.w - 16, h: m.h - 8 - 90 };
}
