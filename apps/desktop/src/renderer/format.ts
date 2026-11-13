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

const UNIT_MS: [RegExp, number][] = [
  [/^(d|t|tag|tage|tagen|days?)$/, 86_400_000],
  [/^(h|std|stunden?|hours?)$/, 3_600_000],
  [/^(m|min|minuten?|minutes?)$/, 60_000],
  [/^(s|sek|sec|sekunden?|seconds?)$/, 1000],
];

/**
 * Uhrabweichung als Text → ms. null bei leerer/ungültiger Eingabe. Versteht
 * "−2:47", "+0:04", "-167" (Sekunden), "+2:00:00", "+1 Tag 2:00:00", "−3 Tage", "+2 h 5 min".
 */
export function parseOffset(text: string): number | null {
  let t = text.trim().replace(/[−–]/g, "-").replace(",", ".").toLowerCase();
  if (!t) return null;
  let sign = 1;
  if (t[0] === "+" || t[0] === "-") {
    sign = t[0] === "-" ? -1 : 1;
    t = t.slice(1).trim();
  }
  let ms = 0;
  // Am Ende darf eine Uhrzeit-Angabe stehen: h:mm:ss, m:ss oder Sekunden.
  const clock = /(?:^|\s)(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  let rest = t;
  if (clock && !/[a-z]$/.test(t)) {
    const parts = [clock[1], clock[2], clock[3]].filter((x): x is string => x !== undefined).map(Number);
    const [h, m, s] = parts.length === 3 ? parts : parts.length === 2 ? [0, ...parts] : [0, 0, parts[0]!];
    ms += (h! * 3600 + m! * 60 + s!) * 1000;
    rest = t.slice(0, clock.index).trim();
  }
  // Davor Mengen mit Einheit: „1 Tag“, „2 h“, „5min“.
  const unitRe = /(\d+(?:\.\d+)?)\s*([a-zäöü]+)/g;
  let consumed = "";
  for (const m of rest.matchAll(unitRe)) {
    const unit = UNIT_MS.find(([re]) => re.test(m[2]!));
    if (!unit) return null;
    ms += Number(m[1]) * unit[1];
    consumed += m[0];
  }
  if (consumed.replace(/\s/g, "") !== rest.replace(/\s/g, "")) return null;
  if (!clock && !consumed) return null;
  return sign * Math.round(ms);
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
