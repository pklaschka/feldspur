import type { SourceKind } from "@feldspur/core/model";
import type { SourceRow } from "../shared/api.ts";
import { formatClock, formatDuration } from "@feldspur/core/time";
import { digitsDurationMs } from "../shared/duration-digits.ts";

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
 * "−2:47", "+0:04", "± 0:00", "-247" (= −2:47), "-45" (Sekunden), "+2:00:00", "+1 Tag 2:00:00", "−3 Tage",
 * "+2 h 5 min".
 */
export function parseOffset(text: string): number | null {
  let t = text.trim().replace(/[−–]/g, "-").replace(",", ".").toLowerCase();
  if (!t) return null;
  let sign = 1;
  // „±“ steht in der Anzeige für eine Abweichung von 0 (offsetText).
  if (t[0] === "+" || t[0] === "-" || t[0] === "±") {
    sign = t[0] === "-" ? -1 : 1;
    t = t.slice(1).trim();
  }
  // Nur Ziffern: von rechts Sekunden, Minuten, Stunden („247“ = 2:47).
  const digits = digitsDurationMs(t);
  if (digits !== undefined) return digits === null ? null : sign * digits;
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

/**
 * Eingabe im Feld „Abweichung“ lesen: null = leer (Abgleich löschen), "invalid" = nicht lesbar (nichts speichern),
 * sonst die Abweichung in ms.
 */
export function readOffsetInput(text: string): number | null | "invalid" {
  if (!text.trim()) return null;
  return parseOffset(text) ?? "invalid";
}

/** "10:15:00" */
export function clock(ms: number): string {
  return formatClock(ms);
}

export function formatDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}.${m}.`;
}

/** „2026-09-14“ → „14.09.2026“. */
export function formatDate(date: string): string {
  return date.split("-").reverse().join(".");
}

/** Heutiges Datum am Rechner („JJJJ-MM-TT“), nach der lokalen Uhr; `toISOString()` gäbe nach Mitternacht den Vortag. */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

type DayRow = Pick<SourceRow, "startMs" | "evidence" | "decision">;

/** Stammt die Lage aus Datei-Metadaten oder Dateiname (nicht von Hand, nicht angesagt, nicht abgeleitet)? */
function fromFile(r: DayRow): boolean {
  if (r.startMs === null) return false;
  const chosen = r.evidence.find((e) => e.chosen && !e.derived);
  if (!chosen) return false;
  const kind = chosen.kind === "checked" ? (r.decision?.basisKind ?? "") : chosen.kind;
  return kind === "metadata" || kind === "filename";
}

/**
 * Häufigster Kalendertag der Startzeiten von Quellen, deren Zeit aus Metadaten oder Dateiname stammt. Die Zeiten
 * sind schon Ortszeit des Einsatzes, der Tag ist also ihr Datum. Bei Gleichstand gewinnt der frühere Tag.
 * `days` zählt die verschiedenen Tage; null, wenn keine Quelle in Frage kommt.
 */
export function dominantDay(rows: DayRow[]): { day: string; count: number; days: number } | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!fromFile(r)) continue;
    const day = new Date(r.startMs!).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const e of counts) if (!best || e[1] > best[1] || (e[1] === best[1] && e[0] < best[0])) best = e;
  return best ? { day: best[0], count: best[1], days: counts.size } : null;
}

/** "10:15" */
export function hm(ms: number): string {
  return formatClock(ms).slice(0, 5);
}

/** Verstärkung in dB mit Vorzeichen und deutschem Komma: „+3,5 dB“, „−2,0 dB“, „±0,0 dB“. */
export function dbText(db: number): string {
  return `${db > 0 ? "+" : db < 0 ? "−" : "±"}${Math.abs(db).toFixed(1).replace(".", ",")} dB`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")} GB`;
}

export const STATUS_TEXT = { ok: "sicher", check: "prüfen", unplaced: "ohne Zeit", context: "Kontext" } as const;

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

/** Mit Sekunden („hh:mm:ss“) oder ohne („hh:mm“). */
export interface ClockOpts {
  seconds?: boolean;
}

/**
 * Maske für Uhrzeiten „hh:mm“ (oder „hh:mm:ss“) beim Tippen: nur Ziffern, der Doppelpunkt kommt von selbst. Eine
 * erste Ziffer über 2 ist die Stunde („9“ → „09“), ebenso eine einzelne Ziffer vor einem getippten Doppelpunkt
 * („9:“ → „09:“).
 */
export function maskClock(input: string, caret = input.length, opts: ClockOpts = {}): string {
  return maskClockAt(input, caret, opts).value;
}

const SEP = /[:.,h ]/;

/**
 * Wie maskClock, mit Schreibmarke: Wird mitten in einer Uhrzeit korrigiert, bleibt der Doppelpunkt stehen, und die
 * Marke bleibt an ihrer Stelle. „15:00“, die 5 gelöscht, ergibt „1:00“ (nicht „10:0“); tippt man dann 6, steht
 * „16:00“ da. Eine Ziffer in einem vollen Teil überschreibt die folgende.
 */
export function maskClockAt(
  input: string,
  caret = input.length,
  opts: ClockOpts = {},
): { value: string; caret: number } {
  const parts = opts.seconds ? 3 : 2;
  const atEnd = caret >= input.length;
  if (SEP.test(input) && !atEnd) {
    // Korrektur mitten im Feld: jeden Teil (Stunden, Minuten, Sekunden) für sich behandeln.
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
      return { digits: digits.slice(0, 2), mark, from, to: from + part.length };
    };
    const pieces: { text: string; from: number }[] = [];
    let from = 0;
    for (let i = 0; i <= input.length; i++) {
      if (i < input.length && !SEP.test(input[i]!)) continue;
      // Mehr Trenner als Teile: der Rest gehört zum letzten Teil.
      if (pieces.length === parts - 1 && i < input.length) continue;
      pieces.push({ text: input.slice(from, i), from });
      from = i + 1;
    }
    const fitted = pieces.map((p) => fit(p.text, p.from));
    const value = fitted.map((f) => f.digits).join(":");
    let at = 0;
    for (const [k, f] of fitted.entries()) {
      if (caret <= f.to || k === fitted.length - 1) {
        at += Math.max(0, Math.min(f.mark, f.digits.length));
        break;
      }
      at += f.digits.length + 1;
    }
    return { value, caret: at };
  }
  let digits = input.replace(/\D/g, "");
  const before = input.slice(0, caret).replace(/\D/g, "").length;
  let pad = 0;
  if (/^\d[:.,h ]/.test(input) || /^[3-9]/.test(digits)) {
    digits = `0${digits}`;
    pad = 1;
  }
  digits = digits.slice(0, 2 * parts);
  let value = (digits.match(/\d{1,2}/g) ?? []).join(":");
  // Ein getippter Trenner nach einem vollen Teil bleibt stehen, damit man „10:“ sieht, bevor die Minuten kommen.
  if (digits.length > 0 && digits.length % 2 === 0 && digits.length < 2 * parts && SEP.test(input.at(-1) ?? ""))
    value += ":";
  const d = Math.min(before + pad, digits.length);
  const at = atEnd ? value.length : d > 0 ? d + Math.floor((d - 1) / 2) : 0;
  return { value, caret: at };
}

/** Länge einer vollständig getippten Uhrzeit: „hh:mm“ oder „hh:mm:ss“. */
export const clockLength = (opts: ClockOpts = {}) => (opts.seconds ? 8 : 5);

/**
 * Fertige Eingabe „hh:mm“ prüfen und ergänzen: „10“ → „10:00“, „930“ → „09:30“, „10:5“ → „10:05“. Mit Sekunden
 * zusätzlich „103045“ → „10:30:45“; ohne getippte Sekunden bleibt es bei „hh:mm“.
 * Leer bleibt leer; ungültige Zeiten (25:00, 10:75) ergeben null.
 */
export function normalizeClock(input: string, opts: ClockOpts = {}): string | null {
  const t = input.trim();
  if (!t) return "";
  const m =
    /^(\d{1,2})(?:[:.,h ](\d{1,2})?(?:[:.,h ](\d{1,2})?)?)?$/.exec(t) ??
    /^(\d{1,2})(\d{2})(\d{2})?$/.exec(t.replace(/\D/g, ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const sec = m[3] === undefined ? null : Number(m[3]);
  if (h > 23 || min > 59 || (sec !== null && sec > 59)) return null;
  if (sec !== null && !opts.seconds) return null;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(min)}${sec === null ? "" : `:${two(sec)}`}`;
}

/** Uhrzeit „hh:mm“ (oder „hh:mm:ss“) um Minuten verschieben, über Mitternacht hinweg; Sekunden bleiben. */
export function stepClock(value: string, minutes: number, opts: ClockOpts = {}): string {
  const n = normalizeClock(value, opts);
  if (!n) return value;
  const total = (((Number(n.slice(0, 2)) * 60 + Number(n.slice(3, 5)) + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}${n.slice(5)}`;
}

/**
 * Fehlermeldung für die Oberfläche. Electron stellt Fehlern aus dem Hauptprozess „Error invoking remote method
 * '…': Error: “ voran (bei eigenen Klassen deren Namen, etwa „ToolError: “); die Person sieht nur die Meldung.
 */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': /, "").replace(/^[A-Za-z]*Error: /, "");
}
