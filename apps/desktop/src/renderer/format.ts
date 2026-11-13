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

/** "10:15:00" */
export function clock(ms: number): string {
  return formatClock(ms);
}

export function formatDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}.${m}.`;
}

/** "10:15" */
export function hm(ms: number): string {
  return formatClock(ms).slice(0, 5);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")} GB`;
}

export const STATUS_TEXT = { ok: "sicher", check: "prüfen", unplaced: "ohne Zeit" } as const;

export const EVIDENCE_LABEL: Record<string, string> = {
  metadata: "Metadaten",
  filename: "Dateiname",
  spoken: "angesagt",
  anchor: "Anker",
  manual: "von Hand",
};

/** Kurzes Kürzel als Symbol je Quellenart. */
export const KIND_GLYPH: Record<SourceKind, string> = {
  video: "▶",
  audio: "◖",
  photo: "◼",
  diary: "✎",
  note: "≡",
  gps: "⌖",
  other: "·",
};

/** „B1: Text“ → Sprecher B1. */
export function splitSpeaker(input: string): { speaker: string | null; text: string } {
  const m = /^\s*([\p{L}\d]{1,6}):\s+(.*)$/su.exec(input);
  return m ? { speaker: m[1]!, text: m[2]! } : { speaker: null, text: input };
}
