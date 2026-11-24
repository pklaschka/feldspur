/**
 * Rahmen eines Tagebucheintrags verschieben oder an Kanten und Ecken in der Größe ändern. Alles in relativen
 * Koordinaten 0 … 1 der Seite; der Rahmen bleibt auf der Seite und wird nie kleiner als MIN_SIZE. Reine Rechnung
 * für `PageCanvas.tsx`, getestet in `apps/desktop/test/region-edit.test.ts`.
 */
import type { Region } from "../../shared/api.ts";

export type Box = Pick<Region, "x" | "y" | "w" | "h">;

/** „move“ verschiebt den ganzen Rahmen, die Himmelsrichtungen ziehen an Kante oder Ecke. */
export type EditMode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Die acht Griffe, im Uhrzeigersinn ab oben links. */
export const HANDLES: Exclude<EditMode, "move">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Kleinster Rahmen, wie beim Aufziehen (1 % der Seite). */
export const MIN_SIZE = 0.01;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Rahmen nach einer Bewegung um `dx`, `dy` (Anteile der Seite) in der Art `mode`. */
export function editBox(box: Box, mode: EditMode, dx: number, dy: number): Box {
  if (mode === "move") {
    return { ...box, x: clamp(box.x + dx, 0, 1 - box.w), y: clamp(box.y + dy, 0, 1 - box.h) };
  }
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  if (mode.includes("w")) left = clamp(left + dx, 0, right - MIN_SIZE);
  if (mode.includes("e")) right = clamp(right + dx, left + MIN_SIZE, 1);
  if (mode.includes("n")) top = clamp(top + dy, 0, bottom - MIN_SIZE);
  if (mode.includes("s")) bottom = clamp(bottom + dy, top + MIN_SIZE, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Pfeiltaste am gewählten Rahmen: ohne Zusatztaste verschieben, mit Alt die rechte bzw. untere Kante ziehen
 * (Größe ändern). Ein Schritt ist 0,5 % der Seite, mit Umschalt 5 %. null = keine Pfeiltaste.
 */
export function nudgeBox(box: Box, key: string, opts: { shift: boolean; alt: boolean }): Box | null {
  const step = opts.shift ? 0.05 : 0.005;
  const dir: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const d = dir[key];
  if (!d) return null;
  if (!opts.alt) return editBox(box, "move", d[0], d[1]);
  return editBox(box, d[0] !== 0 ? "e" : "s", d[0], d[1]);
}

/** Gleicher Rahmen? (Rundungsrauschen unter 0,01 % zählt nicht.) */
export function sameBox(a: Box, b: Box): boolean {
  const eps = 1e-4;
  return (
    Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps
  );
}

/** Mauszeiger je Griff. */
export const CURSOR: Record<EditMode, string> = {
  move: "move",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};
