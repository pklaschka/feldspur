/**
 * Rechnen für den Ausschnitt der Zeitachse in Durchsehen: welcher Zeitraum gezeigt wird, wie weit gezoomt und
 * gescrollt werden kann und wohin ein Zoom oder Sprung den Ausschnitt schiebt. Ohne React und DOM, damit es sich
 * prüfen lässt. Zeiten in ms, Zoom in Pixeln pro Minute, Scrollposition in Pixeln.
 */
import type { SourceRow } from "../../shared/api.ts";
import { MIN } from "../timeline.ts";

/** Stärkster Zoom: Pixel pro Minute. */
export const MAX_PPM = 240;

/** Zeitraum der Achse: alle eingeordneten Quellen, zwei Minuten Rand, auf fünf Minuten gerundet. */
export function axisRange(placed: SourceRow[]): { t0: number; t1: number } {
  const starts = placed.map((r) => r.startMs ?? r.diaryWindow!.toMs);
  const ends = placed.map((r) => Math.max(r.endMs ?? r.startMs ?? 0, r.diaryWindow?.toMs ?? 0));
  const step = 5 * MIN;
  return {
    t0: Math.floor((Math.min(...starts) - 2 * MIN) / step) * step,
    t1: Math.ceil((Math.max(...ends) + 2 * MIN) / step) * step,
  };
}

/** Zoom, bei dem der ganze Zeitraum genau in die Breite passt (mindestens 0,2 px/min). */
export const fitPpm = (width: number, t0: number, t1: number) => Math.max(0.2, (width - 2) / ((t1 - t0) / MIN));

/** Weiteste Scrollposition bei diesem Zoom. */
export const maxScroll = (t0: number, t1: number, ppm: number, width: number) =>
  Math.max(0, ((t1 - t0) / MIN) * ppm - width);

/** Scrollposition, bei der die Zeit `t` an der Bildschirmstelle `x` steht, begrenzt auf den gültigen Bereich. */
export function scrollFor(t: number, x: number, ppm: number, { t0, t1, width }: Axis): number {
  return Math.min(maxScroll(t0, t1, ppm, width), Math.max(0, ((t - t0) / MIN) * ppm - x));
}

export interface Axis {
  t0: number;
  t1: number;
  width: number;
}

/**
 * Zoomen und dabei die Zeit `anchor.t` an der Bildschirmstelle `anchor.x` festhalten. Der Zoom bleibt zwischen
 * Einpassen und MAX_PPM; `zoom` ist null, wenn er (fast) beim Einpassen landet.
 */
export function zoomAround(
  next: number,
  anchor: { t: number; x: number },
  axis: Axis,
): { ppm: number; zoom: number | null; scrollX: number } {
  const fit = fitPpm(axis.width, axis.t0, axis.t1);
  const ppm = Math.min(MAX_PPM, Math.max(fit, next));
  return { ppm, zoom: ppm <= fit * 1.001 ? null : ppm, scrollX: scrollFor(anchor.t, anchor.x, ppm, axis) };
}

/** Zoom, bei dem ein Bereich 80 % der Breite füllt (für Sprünge aus der Suche). */
export const revealPpm = (fromMs: number, toMs: number, axis: Axis) =>
  Math.min(MAX_PPM, Math.max(fitPpm(axis.width, axis.t0, axis.t1), (axis.width * 0.8) / ((toMs - fromMs) / MIN)));

/** Zoomfaktor für ein Mausrad-Ereignis; Strg + Rad (Touchpad-Spreizen) kommt in kleinen Schritten. */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean, width: number): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? width : 1;
  return Math.exp(-deltaY * unit * (ctrlKey ? 0.01 : 0.0015));
}
