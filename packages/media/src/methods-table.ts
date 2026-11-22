/**
 * „Tabelle für den Methodenteil“ (Issue #149): aus den Zahlen der Einsätze zwei Tabellen zum Kopieren, eine für den
 * Eingang (Aufzeichnungen je Art und Gerät) und eine für die Ausgabe (Einsatztranskript und Montagevideo je Einsatz).
 * Ohne Node und ohne Electron (nur Typ-Importe), damit Ausgabe (LIESMICH), Oberfläche und Tests dieselben Texte nutzen.
 * Nur Gezähltes und Gemessenes, keine Bewertung.
 */
import type { SourceKind } from "@feldspur/core";
import type { MethodsBasis, MethodsMaterialRow, MethodsSessionSummary } from "./methods-summary.ts";

/** Was die Tabellen von einem Einsatz brauchen (ohne den Stand der Ausgabe). */
export type MethodsNumbers = Pick<MethodsSessionSummary, "title" | "date" | "material" | "output">;

/** Abschnitt des Handbuchs mit dem Mustertext, der erklärt, was Montagevideo und Einsatztranskript sind. */
export const METHODS_HANDBOOK_URL = "https://purl.archive.org/feldspur#sec-methodenteil";

export interface MethodsTable {
  caption: string;
  head: string[];
  rows: string[][];
}

const KIND_TEXT: Record<SourceKind, string> = {
  video: "Video",
  audio: "Audio",
  photo: "Fotos",
  diary: "Tagebuch",
  note: "Notizen",
  gps: "GPS",
  other: "Sonstiges",
};
const KIND_ORDER = Object.keys(KIND_TEXT) as SourceKind[];

/** Zeitbelege in der Reihenfolge, in der sie in der Zelle stehen; Wörter wie im Handbuch („Zeitbeleg“). */
const BASIS_TEXT: [MethodsBasis, string][] = [
  ["metadata", "Metadaten"],
  ["filename", "Dateiname"],
  ["spoken", "angesagte Uhrzeit"],
  ["anchor", "Anker"],
  ["manual", "von Hand"],
  ["checked", "nach Prüfung entschieden"],
  ["diary", "notierte Uhrzeit"],
  ["follows", "Folgeaufnahme"],
  ["part", "Teil einer Seite"],
  ["context", "Kontext, ohne Uhrzeit"],
  ["none", "ohne Uhrzeit"],
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Dauer immer als h:mm:ss, damit „4:10“ nicht als Stunden oder Minuten gelesen werden kann. */
export function hms(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** „+0:42“, „−2:47“, ab einer Stunde „+1:00:00“. */
function correction(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  const sign = ms < 0 ? "−" : "+";
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return h ? `${sign}${h}:${pad(m)}:${pad(s % 60)}` : `${sign}${m}:${pad(s % 60)}`;
}

/** „2026-09-14“ → „14.09.2026“. */
export function germanDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Gleiche Art und gleiches Gerät aus mehreren Einsätzen zu einer Zeile zusammenfassen. */
export function combineMaterial(sessions: MethodsNumbers[]): MethodsMaterialRow[] {
  const rows = new Map<string, MethodsMaterialRow>();
  for (const s of sessions) {
    for (const r of s.material) {
      const key = `${r.kind}\n${r.device}`;
      const sum = rows.get(key);
      if (!sum) {
        rows.set(key, { ...r, basis: { ...r.basis }, correctionsMs: [...r.correctionsMs] });
        continue;
      }
      sum.files += r.files;
      sum.durationMs += r.durationMs;
      if (r.entries !== undefined) sum.entries = (sum.entries ?? 0) + r.entries;
      for (const [k, n] of Object.entries(r.basis) as [MethodsBasis, number][]) sum.basis[k] = (sum.basis[k] ?? 0) + n;
      for (const c of r.correctionsMs) if (!sum.correctionsMs.includes(c)) sum.correctionsMs.push(c);
    }
  }
  return [...rows.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.device.localeCompare(b.device, "de"),
  );
}

/** Zelle „Zeitbeleg“: ein Beleg ohne Zahl, mehrere mit Anzahl der Dateien; dahinter die Korrektur der Geräteuhr. */
export function basisText(row: MethodsMaterialRow): string {
  const used = BASIS_TEXT.filter(([k]) => row.basis[k]);
  let text =
    used.length === 1
      ? used[0]![1]
      : used.map(([k, label]) => `${label} (${row.basis[k]})`).join(", ") ||
        (row.kind === "diary" ? "notierte Uhrzeit" : "–");
  const c = [...row.correctionsMs].sort((a, b) => a - b);
  if (c.length === 1) text += `; Uhr um ${correction(c[0]!)} korrigiert`;
  else if (c.length > 1) text += `; Uhr korrigiert (${correction(c[0]!)} bis ${correction(c.at(-1)!)})`;
  return text;
}

function countText(row: MethodsMaterialRow): string {
  if (row.kind !== "diary" || row.entries === undefined) return String(row.files);
  const entries = count(row.entries, "Eintrag", "Einträge");
  return row.files ? `${entries}, ${count(row.files, "Datei", "Dateien")}` : entries;
}

/** „einem Einsatz (14.09.2026)“ oder „4 Einsätzen (14.09.2026 bis 17.09.2026)“. */
function span(sessions: MethodsNumbers[]): string {
  const dates = sessions.map((s) => s.date).sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return "keinem Einsatz";
  const days = first === last ? germanDate(first) : `${germanDate(first)} bis ${germanDate(last)}`;
  return sessions.length === 1 ? `einem Einsatz (${days})` : `${sessions.length} Einsätzen (${days})`;
}

/** Eingang: was hineingeflossen ist, je Art und Gerät über alle gewählten Einsätze. */
export function materialTable(sessions: MethodsNumbers[]): MethodsTable {
  return {
    caption: `Eingang: Aufzeichnungen aus ${span(sessions)}`,
    head: ["Eingang", "Gerät", "Anzahl", "Dauer (h:mm:ss)", "Zeitbeleg"],
    rows: combineMaterial(sessions).map((r) => [
      KIND_TEXT[r.kind],
      r.device || "–",
      countText(r),
      r.kind === "audio" || r.kind === "video" ? hms(r.durationMs) : "–",
      basisText(r),
    ]),
  };
}

/** Einsätze, aus denen sich etwas ausgeben lässt (mindestens eine Quelle mit Uhrzeit). */
export const withOutput = <T extends MethodsNumbers>(sessions: T[]): T[] =>
  sessions.filter((s) => s.output.durationMs > 0);

/** Ausgabe: je Einsatz das Einsatztranskript und, wenn es mit ausgegeben wird, das Montagevideo. */
export function outputTable(sessions: MethodsNumbers[]): MethodsTable {
  const rows: string[][] = [];
  for (const s of withOutput(sessions).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))) {
    const o = s.output;
    const lines = count(o.lines, "Zeile", "Zeilen");
    rows.push([
      `${germanDate(s.date)} ${s.title}`,
      "Einsatztranskript",
      ".docx",
      o.context ? `${lines}, ${count(o.context, "Kontextstück", "Kontextstücke")}` : lines,
      o.montageId,
    ]);
    if (o.video) rows.push(["", "Montagevideo", ".mp4", `${hms(o.durationMs)}, ${o.mode}`, ""]);
  }
  return {
    caption: "Ausgabe: Einsatztranskript und Montagevideo je Einsatz",
    head: ["Einsatz", "Ausgabe", "Datei", "Umfang", "Montage-ID"],
    rows,
  };
}

const mdCell = (s: string) => s.replace(/\|/g, "\\|") || " ";

/** Tabellen als Markdown, darunter die Zeile zur Software. */
export function methodsMarkdown(tables: MethodsTable[], software: string): string {
  const blocks = tables.map((t) =>
    [
      `**${t.caption}**`,
      "",
      `| ${t.head.map(mdCell).join(" | ")} |`,
      `| ${t.head.map(() => "---").join(" | ")} |`,
      ...t.rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`),
    ].join("\n"),
  );
  return [...blocks, software].join("\n\n") + "\n";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Tabellen als HTML für die Zwischenablage: Word, LibreOffice und Pages fügen daraus echte Tabellen ein. */
export function methodsHtml(tables: MethodsTable[], software: string): string {
  const cell = "border:1px solid #888;padding:3px 6px;text-align:left;vertical-align:top";
  const blocks = tables.map(
    (t) =>
      `<p><b>${esc(t.caption)}</b></p>` +
      `<table style="border-collapse:collapse">` +
      `<thead><tr>${t.head.map((h) => `<th style="${cell}">${esc(h)}</th>`).join("")}</tr></thead>` +
      `<tbody>${t.rows
        .map((r) => `<tr>${r.map((c) => `<td style="${cell}">${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`,
  );
  return `${blocks.join("")}<p>${esc(software)}</p>`;
}

/** Tabellen als Text mit Tabulatoren: der Ersatz, wenn das Ziel kein HTML annimmt (auch für Tabellenprogramme). */
export function methodsPlain(tables: MethodsTable[], software: string): string {
  const clean = (s: string) => s.replace(/[\t\n]+/g, " ");
  const blocks = tables.map((t) =>
    [t.caption, [t.head, ...t.rows].map((r) => r.map(clean).join("\t")).join("\n")].join("\n"),
  );
  return [...blocks, software].join("\n\n") + "\n";
}
