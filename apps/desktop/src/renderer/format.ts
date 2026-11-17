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
  checked: "geprüft",
};

/** „B1: Text“ → Sprecher B1. */
export function splitSpeaker(input: string): { speaker: string | null; text: string } {
  const m = /^\s*([\p{L}\d]{1,6}):\s+(.*)$/su.exec(input);
  return m ? { speaker: m[1]!, text: m[2]! } : { speaker: null, text: input };
}

/**
 * Maske für Uhrzeiten „hh:mm“ beim Tippen: nur Ziffern, der Doppelpunkt kommt von selbst. Eine erste Ziffer über 2
 * ist die Stunde („9“ → „09“), ebenso eine einzelne Ziffer vor einem getippten Doppelpunkt („9:“ → „09:“).
 */
export function maskClock(input: string, caret = input.length): string {
  return maskClockAt(input, caret).value;
}

const SEP = /[:.,h ]/;

/**
 * Wie maskClock, mit Schreibmarke: Wird mitten in einer Uhrzeit korrigiert, bleibt der Doppelpunkt stehen, und die
 * Marke bleibt an ihrer Stelle. „15:00“, die 5 gelöscht, ergibt „1:00“ (nicht „10:0“); tippt man dann 6, steht
 * „16:00“ da. Eine Ziffer in einem vollen Teil überschreibt die folgende.
 */
export function maskClockAt(input: string, caret = input.length): { value: string; caret: number } {
  const atEnd = caret >= input.length;
  const sep = input.search(SEP);
  if (sep >= 0 && !atEnd) {
    // Korrektur mitten im Feld: Stunden und Minuten getrennt behandeln.
    const fit = (part: string, from: number) => {
      let digits = "";
      let mark = -1;
      for (let i = 0; i < part.length; i++) {
        if (from + i === caret) mark = digits.length;
        if (/\d/.test(part[i]!)) digits += part[i];
      }
      if (from + part.length === caret) mark = digits.length;
      // Zu lang: die Ziffer hinter der Marke fällt weg (überschreiben), sonst die letzte.
      if (digits.length > 2)
        digits =
          mark >= 0 && mark < digits.length ? digits.slice(0, mark) + digits.slice(mark + 1) : digits.slice(0, 2);
      return { digits: digits.slice(0, 2), mark };
    };
    const h = fit(input.slice(0, sep), 0);
    const m = fit(input.slice(sep + 1), sep + 1);
    const value = `${h.digits}:${m.digits}`;
    const at =
      h.mark >= 0 && caret <= sep
        ? Math.min(h.mark, h.digits.length)
        : h.digits.length + 1 + Math.max(0, Math.min(m.mark, m.digits.length));
    return { value, caret: at };
  }
  let digits = input.replace(/\D/g, "");
  const before = input.slice(0, caret).replace(/\D/g, "").length;
  let pad = 0;
  if (/^\d[:.,h ]/.test(input) || /^[3-9]/.test(digits)) {
    digits = `0${digits}`;
    pad = 1;
  }
  digits = digits.slice(0, 4);
  let value: string;
  if (digits.length < 2) value = digits;
  // Ein getippter Trenner nach der Stunde bleibt stehen, damit man „10:“ sieht, bevor die Minuten kommen.
  else if (digits.length === 2) value = SEP.test(input.at(-1) ?? "") ? `${digits}:` : digits;
  else value = `${digits.slice(0, 2)}:${digits.slice(2)}`;
  const d = Math.min(before + pad, digits.length);
  const at = atEnd ? value.length : d > 2 ? d + 1 : d;
  return { value, caret: at };
}

/**
 * Fertige Eingabe „hh:mm“ prüfen und ergänzen: „10“ → „10:00“, „930“ → „09:30“, „10:5“ → „10:05“.
 * Leer bleibt leer; ungültige Zeiten (25:00, 10:75) ergeben null.
 */
export function normalizeClock(input: string): string | null {
  const t = input.trim();
  if (!t) return "";
  const m = /^(\d{1,2})(?:[:.,h ](\d{1,2})?)?$/.exec(t) ?? /^(\d{1,2})(\d{2})$/.exec(t.replace(/\D/g, ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Uhrzeit „hh:mm“ um Minuten verschieben, über Mitternacht hinweg. */
export function stepClock(value: string, minutes: number): string {
  const n = normalizeClock(value);
  if (!n) return value;
  const total = (((Number(n.slice(0, 2)) * 60 + Number(n.slice(3)) + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
