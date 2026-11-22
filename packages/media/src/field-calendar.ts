/**
 * Feldkalender (Issue #205): je Feldtag eine Zeile auf einer gemeinsamen Uhrzeit-Achse, mit Ton, Video, Fotos und
 * Tagebuch als Marken. Feldspur legt die Tage nur untereinander; Muster zu erkennen bleibt bei den Forschenden. Farbe
 * steht für die Art der Quelle, nie für eine Menge.
 *
 * Die Zeiten sind Wanduhrzeiten am Einsatzort (LocalMs). Die Achse rechnet sie auf die Uhrzeit des Tages um, damit
 * Tage mit verschiedenem Datum übereinander liegen.
 */
import type { SessionTranscript } from "./session-transcript.ts";

/** Wanduhrzeit am Einsatzort in ms, gelesen als UTC (wie LocalMs im Kern). */
type LocalMs = number;
import { germanDate } from "./methods-table.ts";

export type CalendarKind = "audio" | "video" | "photo" | "diary";

/** Eine Marke: Aufnahme (Bereich), Foto oder Tagebucheintrag (Zeitpunkt). */
export interface CalendarMark {
  kind: CalendarKind;
  fromMs: LocalMs;
  toMs: LocalMs;
}

export interface CalendarDay {
  date: string;
  title: string;
  place: string;
  marks: CalendarMark[];
}

export const CALENDAR_KINDS: CalendarKind[] = ["audio", "video", "photo", "diary"];
export const CALENDAR_LABEL: Record<CalendarKind, string> = {
  audio: "Ton",
  video: "Video",
  photo: "Fotos",
  diary: "Tagebuch",
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Marken eines Einsatzes. Tagebucheinträge stehen zur Notierzeit, so wie im Einsatztranskript angezeigt. */
export function calendarMarks(transcript: SessionTranscript): CalendarMark[] {
  const { input, resolved } = transcript;
  const marks: CalendarMark[] = [];
  for (const s of input.sources) {
    if (s.partOf || (s.kind !== "audio" && s.kind !== "video" && s.kind !== "photo")) continue;
    const p = resolved.placements.get(s.id);
    if (p) marks.push({ kind: s.kind, fromMs: p.startMs, toMs: s.kind === "photo" ? p.startMs : p.endMs });
  }
  for (const d of resolved.diary.values()) marks.push({ kind: "diary", fromMs: d.notedAtMs, toMs: d.notedAtMs });
  // Bereiche zuerst, damit Punkte darüber liegen; sonst nach Zeit.
  return marks.sort((a, b) => Number(a.fromMs === a.toMs) - Number(b.fromMs === b.toMs) || a.fromMs - b.fromMs);
}

/** Mitternacht des Datums als LocalMs. */
export const dayStart = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** Uhrzeit des Tages in ms (über Mitternacht hinaus größer als 24 h). */
export const ofDay = (date: string, t: number): number => t - dayStart(date);

/**
 * Achse für alle Tage: volle Stunden um die früheste und späteste Marke, mindestens zwei Stunden breit. Ohne Marken
 * 8 bis 18 Uhr, damit die Zeilen nicht leer im Nichts stehen.
 */
export function calendarAxis(days: CalendarDay[]): { fromMs: number; toMs: number; ticks: number[] } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of days)
    for (const m of d.marks) {
      lo = Math.min(lo, ofDay(d.date, m.fromMs));
      hi = Math.max(hi, ofDay(d.date, m.toMs));
    }
  if (!Number.isFinite(lo)) [lo, hi] = [8 * HOUR, 18 * HOUR];
  let fromMs = Math.floor(lo / HOUR) * HOUR;
  let toMs = Math.ceil(hi / HOUR) * HOUR;
  if (toMs - fromMs < 2 * HOUR) {
    fromMs = Math.max(fromMs - HOUR, Math.min(0, fromMs));
    toMs = fromMs + 2 * HOUR;
  }
  const span = toMs - fromMs;
  const step = span > 12 * HOUR ? 3 * HOUR : span > 6 * HOUR ? 2 * HOUR : HOUR;
  const ticks: number[] = [];
  for (let t = Math.ceil(fromMs / step) * step; t <= toMs; t += step) ticks.push(t);
  return { fromMs, toMs, ticks };
}

/** „10“ für 10 Uhr; über Mitternacht „+1 02“. */
export function hourLabel(ms: number): string {
  const days = Math.floor(ms / DAY);
  const h = Math.floor((ms - days * DAY) / HOUR);
  return `${days > 0 ? `+${days} ` : days < 0 ? `${days} ` : ""}${String(h).padStart(2, "0")}`;
}

/** Farben der Arten wie in der App (helles Thema), für eine Grafik auf weißem Grund. */
const KIND_FILL: Record<CalendarKind, string> = {
  video: "#3b5d85",
  audio: "#44692f",
  photo: "#7e4877",
  diary: "#8e5524",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Der Feldkalender als SVG-Grafik, etwa für den Methodenteil: Uhrzeit-Achse oben, je Tag eine Zeile mit Datum, Titel
 * und Ort, darin eine Spur je Art. Eigenständig (keine Schriften, keine Verweise nach außen).
 */
export function fieldCalendarSvg(days: CalendarDay[]): string {
  const axis = calendarAxis(days);
  const W = 960;
  const LEFT = 240;
  const RIGHT = 16;
  const TOP = 44;
  const LANE = 7;
  const ROW = CALENDAR_KINDS.length * LANE + 18;
  const LEGEND = 30;
  const H = TOP + days.length * ROW + LEGEND;
  const x = (ms: number) => LEFT + ((ms - axis.fromMs) / (axis.toMs - axis.fromMs)) * (W - LEFT - RIGHT);
  /** Raute für ein Foto, um (cx, cy). */
  const diamond = (cx: number, cy: number) =>
    `<rect x="${(cx - 3).toFixed(1)}" y="${(cy - 3).toFixed(1)}" width="6" height="6" transform="rotate(45 ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="${KIND_FILL.photo}"/>`;
  const font = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${font} font-size="12">`,
    `<title>Feldkalender: ${days.length} ${days.length === 1 ? "Feldtag" : "Feldtage"} auf einer Uhrzeit-Achse</title>`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
  ];
  for (const t of axis.ticks) {
    out.push(
      `<line x1="${x(t).toFixed(1)}" y1="${TOP - 8}" x2="${x(t).toFixed(1)}" y2="${TOP + days.length * ROW}" stroke="#d7dccf" stroke-width="1"/>`,
      `<text x="${x(t).toFixed(1)}" y="${TOP - 14}" text-anchor="middle" fill="#5b5d53">${hourLabel(t)}:00</text>`,
    );
  }
  days.forEach((d, i) => {
    const y = TOP + i * ROW;
    if (i > 0) out.push(`<line x1="16" y1="${y}" x2="${W - RIGHT}" y2="${y}" stroke="#e6e8df" stroke-width="1"/>`);
    out.push(
      `<text x="16" y="${y + 15}" fill="#26241f" font-weight="600">${esc(germanDate(d.date))} ${esc(d.title)}</text>`,
    );
    if (d.place) out.push(`<text x="16" y="${y + 30}" fill="#5b5d53">${esc(d.place)}</text>`);
    for (const m of d.marks) {
      const lane = CALENDAR_KINDS.indexOf(m.kind);
      const ly = y + 9 + lane * LANE;
      const x1 = x(ofDay(d.date, m.fromMs));
      const x2 = x(ofDay(d.date, m.toMs));
      out.push(
        m.kind === "photo"
          ? diamond(x1, ly + (LANE - 1) / 2)
          : m.fromMs === m.toMs
            ? `<rect x="${(x1 - 1).toFixed(1)}" y="${ly - 1}" width="2" height="${LANE + 1}" fill="${KIND_FILL[m.kind]}"/>`
            : `<rect x="${x1.toFixed(1)}" y="${ly}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="${LANE - 1}" rx="1" fill="${KIND_FILL[m.kind]}"/>`,
      );
    }
  });
  let lx = LEFT;
  const ly = TOP + days.length * ROW + 20;
  for (const k of CALENDAR_KINDS) {
    out.push(
      k === "photo"
        ? diamond(lx + 6, ly - 4)
        : k === "diary"
          ? `<rect x="${lx + 5}" y="${ly - 10}" width="2" height="11" fill="${KIND_FILL[k]}"/>`
          : `<rect x="${lx}" y="${ly - 7}" width="14" height="6" rx="1" fill="${KIND_FILL[k]}"/>`,
      `<text x="${lx + 19}" y="${ly}" fill="#26241f">${CALENDAR_LABEL[k]}</text>`,
    );
    lx += 17 + CALENDAR_LABEL[k].length * 7 + 22;
  }
  out.push("</svg>");
  return out.join("\n") + "\n";
}
