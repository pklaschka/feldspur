/**
 * Projektordner (Issue #209, Stufe 7 des Gesamtkonzepts #202): „Alle Einsätze ausgeben…“ in der Übersicht schreibt die
 * gewählten Einsätze in einen gemeinsamen Ordner, je Einsatz ein Unterordner, wie ihn der Schritt „Ausgeben“ schreibt.
 * Darüber liegt eine LIESMICH mit den Tabellen über alle Einsätze, dem Feldkalender und der Liste der Ordner mit ihren
 * Montage-IDs. So zählen die Tabelle im Aufsatz und der Ordner im Archiv dasselbe.
 *
 * Hier entsteht nur der Text der LIESMICH, ohne Dateizugriff. Die Einsätze schreibt und prüft der Hauptprozess
 * (`apps/desktop/src/main/project-export.ts`); die Metadaten des Projektordners baut `projectRoCrateJson`
 * (`ro-crate.ts`) aus demselben Datenobjekt (`ProjectFolder`).
 *
 * Die LIESMICH beschreibt genau die Ordner, die sie nennt, im Stand ihrer Ausgabe. Zitiert wird weiter aus dem Ordner
 * eines Einsatzes mit seiner Montage-ID; der Projektordner trägt keine eigene.
 */
import type { DatasetInfo } from "@feldspur/core/model";
import { cleanDataset, DATASET_FIELDS, README_NAME, RO_CRATE_NAME } from "./dataset.ts";
import { fieldCalendarSvg, type CalendarMark } from "./field-calendar.ts";
import { germanDate, materialTable, METHODS_HANDBOOK_URL, outputTable, type MethodsNumbers } from "./methods-table.ts";
import { README_CSS, tableHtml } from "./readme.ts";
import { htmlEscape } from "./xml.ts";

/** Kennzeichen im Kopf der LIESMICH eines Projektordners: Daran erkennt Feldspur seinen Ordner wieder. */
export const PROJECT_README_MARK = '<meta name="feldspur-projektordner"';

/** Ein Einsatz im Projektordner, im Stand seiner Ausgabe. */
export interface ProjectFolderSession {
  /** Name des Unterordners. */
  folder: string;
  /** Kennwerte des Einsatzes (dieselben wie in Übersicht und LIESMICH des Einsatzes). */
  numbers: MethodsNumbers;
  place: string;
  /** Marken für den Feldkalender. */
  marks: CalendarMark[];
  /** Zeitpunkt der Ausgabe dieses Einsatzes (ISO 8601). */
  exportedAt: string;
  /** Dateien im Unterordner, relativ zu ihm. */
  files: string[];
}

/** Die gemeinsame Beschreibung eines Projektordners: das eine Datenobjekt für LIESMICH und Metadaten. */
export interface ProjectFolder {
  /** Name des Projekts; Titel, solange kein Titel des Datensatzes eingetragen ist. */
  name: string;
  /** Angaben zum Datensatz für das ganze Projekt (ohne die Abweichungen einzelner Einsätze). */
  dataset: DatasetInfo;
  /** Forschende an den Geräten: Urheber*innen, solange keine eingetragen sind. */
  researchers: string[];
  /** Die Einsätze im Ordner, nach Datum. */
  sessions: ProjectFolderSession[];
  /** Liegen die Metadaten (`ro-crate-metadata.json`) daneben? */
  roCrate: boolean;
  /** Zeile zur Software mit Version und DOI; die App liefert sie. */
  software?: string;
  /** Weitere Unterordner aus früheren Ausgaben, die diese Beschreibung nicht umfasst. */
  others: string[];
}

const esc = htmlEscape;

/** „14.09.2026“ oder „14.09.2026 bis 17.09.2026“; leer ohne Einsatz. */
export function projectSpan(sessions: readonly ProjectFolderSession[]): string {
  const dates = sessions.map((s) => s.numbers.date).sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return "";
  return first === last ? germanDate(first) : `${germanDate(first)} bis ${germanDate(last)}`;
}

/** Tag und Uhrzeit einer Ausgabe für die Liste, in der Zeitzone des Rechners: „20.09.2026, 10:15“. */
function exportedText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Adresse einer Datei im Unterordner, für einen Verweis innerhalb des Projektordners. */
const href = (folder: string, file: string) => `${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;

/** Die Liste der Einsatzordner als Tabelle: Einsatz, Ordner, Montage-ID, Zeitpunkt der Ausgabe. */
function folderTable(sessions: readonly ProjectFolderSession[]): string {
  const rows = sessions.map((s) => {
    const n = s.numbers;
    const name = s.files.includes(README_NAME)
      ? `<a href="${esc(href(s.folder, README_NAME))}">${esc(s.folder)}/</a>`
      : `${esc(s.folder)}/`;
    return (
      `<tr><td>${esc(germanDate(n.date))} ${esc(n.title)}${s.place ? `<br><span class="sub">${esc(s.place)}</span>` : ""}</td>` +
      `<td>${name}</td>` +
      `<td class="nw"><span class="id">${esc(n.output.montageId)}</span></td>` +
      `<td class="nw">${esc(exportedText(s.exportedAt))}</td></tr>`
    );
  });
  return (
    `<p class="cap" id="ordner">Einsätze in diesem Ordner</p>` +
    `<div class="scroll"><table aria-labelledby="ordner">` +
    `<thead><tr><th scope="col">Einsatz</th><th scope="col">Ordner</th><th scope="col">Montage-ID</th><th scope="col">Ausgegeben am</th></tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table></div>`
  );
}

/** Abschnitt „Angaben zum Datensatz“ fürs Projekt: nur Eingetragenes; ohne Angaben und ohne Metadaten entfällt er. */
function datasetHtml(p: ProjectFolder): string {
  const d = cleanDataset(p.dataset);
  const entered = DATASET_FIELDS.flatMap(({ key, label }) => (d[key] ? [[label, d[key]] as const] : []));
  if (!entered.length && !p.roCrate) return "";
  const value = (v: string) => esc(v).replace(/\r?\n/g, "<br>");
  const list = entered.length
    ? `<dl>\n${entered.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${value(v)}</dd>`).join("\n")}\n</dl>`
    : `<p class="note">Zu diesem Datensatz sind keine Angaben eingetragen.</p>`;
  const json = p.roCrate
    ? `\n<p class="note">Dieselben Angaben stehen maschinenlesbar in <code>${RO_CRATE_NAME}</code> (RO-Crate 1.2), dazu die Ordner der Einsätze mit ihren Dateien.</p>`
    : "";
  return `<h2>Angaben zum Datensatz</h2>\n${list}${json}\n`;
}

/** Die LIESMICH des Projektordners als vollständige HTML-Datei, ohne Skript und ohne Verweise nach außen. */
export function projectReadmeHtml(p: ProjectFolder): string {
  const sessions = [...p.sessions].sort(
    (a, b) => a.numbers.date.localeCompare(b.numbers.date) || a.numbers.title.localeCompare(b.numbers.title),
  );
  const numbers = sessions.map((s) => s.numbers);
  const tables = [materialTable(numbers), outputTable(numbers)];
  const title = cleanDataset(p.dataset).title ?? p.name;
  const count = sessions.length === 1 ? "einem Einsatz" : `${sessions.length} Einsätzen`;
  const calendar = fieldCalendarSvg(
    sessions.map((s) => ({ date: s.numbers.date, title: s.numbers.title, place: s.place, marks: s.marks })),
  );
  const others = p.others.length
    ? `<p class="note">Außerdem ${p.others.length === 1 ? "liegt hier ein Ordner" : "liegen hier Ordner"} aus einer früheren Ausgabe, ${p.others.length === 1 ? "den" : "die"} diese Beschreibung nicht umfasst: ${p.others.map((o) => `<code>${esc(o)}/</code>`).join(", ")}.</p>`
    : "";
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="generator" content="Feldspur">
${PROJECT_README_MARK} content="${sessions.length}">
<title>LIESMICH · ${esc(title)}</title>
<style>${README_CSS}
/* Der Feldkalender füllt die Breite; auf schmalen Bildschirmen bleibt er lesbar groß und rollt zur Seite. */
.calendar svg { display: block; width: 100%; min-width: 40rem; height: auto; border: 1px solid var(--line); border-radius: 6px; }
@media print { .calendar svg { min-width: 0; } }
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="sub">Ausgabe eines Projekts mit ${count}${sessions.length ? `, ${esc(projectSpan(sessions))}` : ""}</p>

${datasetHtml(p)}
<h2>Was in diesem Ordner liegt</h2>
<p>Je Einsatz ein Ordner. Jeder ist für sich vollständig: Er enthält das Einsatztranskript, das Begleitprotokoll und, je nach Auswahl, Montagevideo, Viewer und eine eigene LIESMICH.</p>
${folderTable(sessions)}
${others}
<h2>Feldkalender</h2>
<p>Alle Einsätze untereinander auf einer gemeinsamen Uhrzeit-Achse. Die Marken zeigen, wann Ton, Video, Fotos und Tagebuch entstanden sind.</p>
<div class="scroll calendar">
${calendar}</div>

<h2>Wie die Teile zusammengehören</h2>
<p>Jeder Einsatz hat eine eigene Zeitachse und eine eigene Montage-ID. Sie hält die Fassung dieses einen Einsatzes fest, also Zeitmarken und Wortlaut. Der Projektordner fasst die Einsätze nur zusammen und trägt keine eigene ID.</p>
<p>Zitiert wird deshalb aus dem Ordner eines Einsatzes: Einsatz, Datum, Uhrzeit, Zeitmarke und seine Montage-ID. Ob ein Einsatzordner noch unverändert ist, zeigt dort die Prüfsummenliste, falls sie mit ausgegeben wurde.</p>

<h2>Für den Methodenteil</h2>
<p>Was in die Einsätze dieses Ordners hineingeflossen ist und was daraus ausgegeben wurde. Die Angaben sind gezählt und gemessen; den Nachweis je Datei führt das Begleitprotokoll im Ordner des Einsatzes.</p>
${tableHtml(tables[0]!, "eingang")}
${tableHtml(tables[1]!, "ausgabe")}
${p.software ? `<p>${esc(p.software)}</p>` : ""}
<p class="note">Einen Mustertext, der Montagevideo und Einsatztranskript in Worten erklärt, enthält das Handbuch im Abschnitt „Im Methodenteil beschreiben“: <a href="${METHODS_HANDBOOK_URL}">${METHODS_HANDBOOK_URL}</a></p>
</main>
</body>
</html>
`;
}
