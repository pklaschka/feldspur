import type { SourceKind } from "@feldspur/core/model";
import { formatClock, formatDuration } from "@feldspur/core/time";

export const KIND_LABEL: Record<SourceKind, string> = {
  video: "Video",
  audio: "Audio",
  photo: "Foto",
  diary: "Tagebuch",
  note: "Notiz",
  gps: "GPS",
  other: "Sonstiges",
};

export function lage(startMs: number | null, endMs: number | null): string {
  if (startMs === null) return "?";
  if (endMs === null || endMs === startMs) return formatClock(startMs);
  return `${formatClock(startMs)} – ${formatClock(endMs)}`;
}

export function offsetText(ms: number | null): string {
  return ms === null ? "unbekannt" : ms === 0 ? "± 0:00" : formatDuration(ms, { sign: true });
}

/** "−2:47", "+0:04", "2:47", "-167" (Sekunden) → ms. null bei leerer/ungültiger Eingabe. */
export function parseOffset(text: string): number | null {
  const t = text.trim().replace("−", "-").replace(",", ".");
  if (!t) return null;
  const m = /^([+-])?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const min = m[2] ? Number(m[2]) : 0;
  const sec = Number(m[3]);
  return sign * Math.round((min * 60 + sec) * 1000);
}
