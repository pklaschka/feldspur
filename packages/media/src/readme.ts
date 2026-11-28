/**
 * LIESMICH.html im Ausgabeordner (Issue #130, mit der Tabelle für den Methodenteil aus Issue #149): erklärt Menschen,
 * was im Ordner liegt, wie die Teile zusammengehören und wie daraus zitiert wird. Darunter stehen die Zahlen zum
 * Einsatz als Tabellen, weil sie die Montage-ID dieser Fassung tragen und so mit ihr aufbewahrt werden.
 *
 * Eine Datei ohne Skript, ohne Schriften und ohne Verweise nach außen, lesbar in jedem Browser und im Druck.
 * Einsatztranskript und Montagevideo sind für sich zitierfähig; die LIESMICH beschreibt sie nur.
 *
 * Einordnung: Schritt „Ausgeben“. `exportSession` (`packages/media/src/export.ts`) schreibt die Datei mit den
 * übrigen Dateien der Ausgabe; die Tabellen kommen aus `packages/media/src/methods-table.ts`.
 */
import {
  describeExport,
  fileRole,
  MANIFEST_NAME,
  README_NAME,
  RO_CRATE_NAME,
  type ExportDescription,
} from "./dataset.ts";
import type { MontageFormat } from "./layout.ts";
import { ORIGINALS_DIR } from "./originals-copy.ts";
import { materialTable, outputTable, germanDate, METHODS_HANDBOOK_URL, type MethodsTable } from "./methods-table.ts";
import { methodsNumbers } from "./methods-summary.ts";
import type { SessionTranscript } from "./session-transcript.ts";
import { htmlEscape } from "./xml.ts";

/** Was die LIESMICH außer dem Einsatztranskript wissen muss. */
export interface ReadmeOptions {
  /** Dateien der Ausgabe im Ordner (ohne Pfad), in der Reihenfolge, in der sie geschrieben werden; fehlt die LIESMICH, wird sie angehängt. */
  files: string[];
  /** Wird das Montagevideo mit ausgegeben? */
  video: boolean;
  /** Auflösung und Bildrate des Montagevideos; stehen hinter seinem Dateinamen. Standard 1280 × 720, 25 Bilder/s. */
  format?: MontageFormat;
  /** Zeile zur Software mit Version und DOI; die App liefert sie, ohne sie entfällt der Absatz. */
  software?: string;
  /**
   * Die gemeinsame Beschreibung der Ausgabe (`describeExport`), aus der auch die Metadaten entstehen. Ohne sie
   * beschreibt die LIESMICH nur Einsatz und Dateien, ohne Angaben zum Datensatz.
   */
  description?: ExportDescription;
  /** Kurzzeichen der Quellen, deren Original beim Kopieren fehlte (Issue #208). */
  missingOriginals?: string[];
}

const esc = htmlEscape;

/**
 * Tabelle mit Überschrift. Die Überschrift steht über dem Rollbereich, damit sie auf schmalen Bildschirmen stehen
 * bleibt; kurze Zellen (Zahlen, Endungen, Montage-ID) brechen nie um.
 */
export function tableHtml(t: MethodsTable, id: string): string {
  const cell = (c: string) => `<td${c.length <= 24 ? ' class="nw"' : ""}>${esc(c)}</td>`;
  return (
    `<p class="cap" id="${id}">${esc(t.caption)}</p>` +
    `<div class="scroll"><table aria-labelledby="${id}">` +
    `<thead><tr>${t.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${t.rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("")}</tbody></table></div>`
  );
}

/** Gestaltung der LIESMICH; dieselbe trägt die LIESMICH des Projektordners (`project-folder.ts`). */
export const README_CSS = `
:root { --bg: #fcfbf7; --ink: #26241f; --muted: #5b5d53; --line: #d7dccf; --accent: #a4441f; --soft: #f4f5ef; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #23201c; --ink: #efe8dc; --muted: #a59a89; --line: #4a433a; --accent: #e48f63; --soft: #292520; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
h1 { font: 600 1.7rem/1.2 Georgia, serif; margin: 0 0 .25rem; }
h2 { font: 600 1.2rem/1.3 Georgia, serif; margin: 2.2rem 0 .5rem; }
p { margin: .5rem 0; max-width: 70ch; }
.sub, .note { color: var(--muted); }
code, .id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; }
.id { background: var(--soft); border: 1px solid var(--line); border-radius: 4px; padding: .05em .35em; white-space: nowrap; }
dl { margin: .5rem 0; }
dt { font-weight: 600; overflow-wrap: anywhere; margin-top: .6rem; }
dd { margin: 0; color: var(--muted); }
.scroll { overflow-x: auto; margin-bottom: .75rem; }
table { border-collapse: collapse; width: 100%; min-width: 34rem; font-size: .93rem; font-variant-numeric: tabular-nums; }
.cap { font-weight: 600; font-size: .93rem; margin: 1.25rem 0 .3rem; }
.nw { white-space: nowrap; }
th, td { text-align: left; vertical-align: top; padding: .3rem .9rem .3rem 0; border-bottom: 1px solid var(--line); }
th { font-weight: 500; color: var(--muted); font-size: .85rem; border-bottom-color: var(--muted); white-space: nowrap; }
a { color: var(--accent); }
th:last-child, td:last-child { padding-right: 0; }
@media print {
  body { background: #fff; color: #000; font-size: 11pt; }
  main { padding: 0; max-width: none; }
  h2 { break-after: avoid; }
  dt, tr { break-inside: avoid; }
  table { min-width: 0; }
  a { color: inherit; }
}
`;

/**
 * Abschnitt „Angaben zum Datensatz“: nur, was eingetragen ist (Vorbelegtes nicht), mehrzeilige Felder mit ihren
 * Zeilenumbrüchen. Ohne Angaben entfällt der Abschnitt, außer die Metadaten liegen bei: Dann sagt er, wo sie stehen.
 */
function datasetHtml(d: ExportDescription, crate: boolean): string {
  if (!d.entered.length && !crate) return "";
  const value = (v: string) => esc(v).replace(/\r?\n/g, "<br>");
  const list = d.entered.length
    ? `<dl>\n${d.entered.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${value(v)}</dd>`).join("\n")}\n</dl>`
    : `<p class="note">Zu diesem Datensatz sind keine Angaben eingetragen.</p>`;
  const json = crate
    ? `\n<p class="note">Dieselben Angaben stehen maschinenlesbar in <code>${RO_CRATE_NAME}</code> (RO-Crate 1.2), dazu Geräte, Personen, Zeiten und die Prüfsummen der Originale.</p>`
    : "";
  return `<h2>Angaben zum Datensatz</h2>\n${list}${json}\n`;
}

/**
 * Die Dateien des Ordners als Liste. Kopien der Originale (Issue #208) stehen als ein Eintrag `Originale/` mit ihrer
 * Zahl, nicht jede einzeln: Die einzelnen Dateien führen Prüfsummenliste und Metadaten.
 */
function fileList(files: string[], role: (f: string) => string, missing: string[]): string {
  const copies = files.filter((f) => f.startsWith(`${ORIGINALS_DIR}/`));
  const rows = files
    .filter((f) => !f.startsWith(`${ORIGINALS_DIR}/`))
    .map((f) => `<dt>${esc(f)}</dt><dd>${esc(role(f))}</dd>`);
  if (copies.length) {
    const n = copies.length === 1 ? "eine Originaldatei" : `${copies.length} Originaldateien`;
    const gone = missing.length ? ` Nicht dabei, weil das Original beim Ausgeben fehlte: ${missing.join(", ")}.` : "";
    // Direkt hinter den Inhalten, vor LIESMICH und Prüfsummenliste.
    const at = rows.findIndex((r) => r.startsWith(`<dt>${README_NAME}<`) || r.startsWith(`<dt>${MANIFEST_NAME}<`));
    rows.splice(
      at < 0 ? rows.length : at,
      0,
      `<dt>${ORIGINALS_DIR}/</dt><dd>${esc(`Kopien der Originale: ${n}, je Gerät ein Ordner. Jeder Name beginnt mit dem Kurzzeichen aus dem Begleitprotokoll; jede Kopie wurde beim Ausgeben gegen die Prüfsumme vom Einsammeln geprüft.${gone}`)}</dd>`,
    );
  }
  return rows.join("\n");
}

/** Die LIESMICH als vollständige HTML-Datei. */
export function exportReadmeHtml(transcript: SessionTranscript, opts: ReadmeOptions): string {
  const h = transcript.header;
  const numbers = methodsNumbers(transcript, opts.video);
  const tables = [materialTable([numbers]), outputTable([numbers])];
  const title = `${h.title} · ${germanDate(h.date)}`;
  const files = opts.files.includes(README_NAME) ? opts.files : [...opts.files, README_NAME];
  // Zweck jeder Datei und die Angaben zum Datensatz aus der gemeinsamen Beschreibung (Issue #206).
  const d = opts.description ?? describeExport(transcript, { files, format: opts.format });
  const roles = new Map(d.files.map((f) => [f.name, f.role]));
  const role = (f: string) => roles.get(f) || fileRole(f, opts.format);
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="generator" content="Feldspur">
<meta name="feldspur-montage-id" content="${esc(h.montageId)}">
<title>LIESMICH · ${esc(title)}</title>
<style>${README_CSS}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="sub">Ausgabe eines Feldeinsatzes${h.place ? ` (${esc(h.place)})` : ""}, Montage-ID <span class="id">${esc(h.montageId)}</span>, ${esc(h.modeLabel)}</p>

${datasetHtml(d, files.includes(RO_CRATE_NAME))}
<h2>Was in diesem Ordner liegt</h2>
<dl>
${fileList(files, role, opts.missingOriginals ?? [])}
</dl>

<h2>Wie die Teile zusammengehören</h2>
<p>Die Aufzeichnungen dieses Einsatzes wurden anhand ihrer Uhrzeiten auf eine gemeinsame Zeitachse gelegt. Das Einsatztranskript führt Mitschrift, Tagebucheinträge und Fotos in zeitlicher Folge; jede Zeile trägt die Uhrzeit und eine Zeitmarke der Form <code>#hh:mm:ss-z#</code>.${
    opts.video
      ? " Die Zeitmarke zeigt auf die Stelle im Montagevideo, das die Aufnahmen aller Geräte zeigt, gleichzeitige nebeneinander."
      : " Diese Ausgabe enthält kein Montagevideo; die Zeitmarken gelten für das Video, das zu dieser Montage gehört."
  }</p>
<p>Die Montage-ID hält die Fassung fest. Die ersten beiden Blöcke stehen für die Montage, also dafür, welche Quelle wo auf der Zeitachse liegt${opts.video ? "; so sind sie auch im Video eingeblendet" : ""}. Der dritte Block steht für den Wortlaut des Einsatztranskripts. Tragen zwei Ausgaben dieselbe ID, stimmen Zeitmarken und Wortlaut überein.</p>

<h2>Aus dieser Ausgabe zitieren</h2>
<p>Zitiert wird die Stelle in dieser Ausgabe: Einsatz, Datum, Uhrzeit, Zeitmarke und die ganze Montage-ID <span class="id">${esc(h.montageId)}</span>. Dazu gehört der Ort, an dem genau diese Fassung aufbewahrt wird, etwa ein Archiv mit dauerhafter Adresse. Der Ordner bleibt dafür als Ganzes und unverändert zusammen.${
    files.includes(MANIFEST_NAME)
      ? ` Ob er noch unverändert ist, zeigt die Prüfsummenliste: <code>sha256sum -c ${MANIFEST_NAME}</code> im Ordner meldet jede geänderte Datei.`
      : ""
  }</p>

<h2>Für den Methodenteil</h2>
<p>Was in diesen Einsatz hineingeflossen ist und was daraus ausgegeben wurde. Die Angaben sind gezählt und gemessen; den Nachweis je Datei führt das Begleitprotokoll.</p>
${tableHtml(tables[0]!, "eingang")}
${tableHtml(tables[1]!, "ausgabe")}
${opts.software ? `<p>${esc(opts.software)}</p>` : ""}
<p class="note">Einen Mustertext, der Montagevideo und Einsatztranskript in Worten erklärt, enthält das Handbuch im Abschnitt „Im Methodenteil beschreiben“: <a href="${METHODS_HANDBOOK_URL}">${METHODS_HANDBOOK_URL}</a></p>
</main>
</body>
</html>
`;
}
