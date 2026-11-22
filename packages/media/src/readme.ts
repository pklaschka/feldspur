/**
 * LIESMICH.html im Ausgabeordner (Issue #130, mit der Tabelle für den Methodenteil aus Issue #149): erklärt Menschen,
 * was im Ordner liegt, wie die Teile zusammengehören und wie daraus zitiert wird. Darunter stehen die Zahlen zum
 * Einsatz als Tabellen, weil sie die Montage-ID dieser Fassung tragen und so mit ihr aufbewahrt werden.
 *
 * Eine Datei ohne Skript, ohne Schriften und ohne Verweise nach außen, lesbar in jedem Browser und im Druck.
 * Einsatztranskript und Montagevideo sind für sich zitierfähig; die LIESMICH beschreibt sie nur.
 */
import { materialTable, outputTable, germanDate, METHODS_HANDBOOK_URL, type MethodsTable } from "./methods-table.ts";
import { methodsNumbers } from "./methods-summary.ts";
import type { SessionTranscript } from "./session-transcript.ts";

export const README_NAME = "LIESMICH.html";

export interface ReadmeOptions {
  /** Dateien der Ausgabe im Ordner (ohne Pfad), in der Reihenfolge, in der sie geschrieben wurden. */
  files: string[];
  /** Wird das Montagevideo mit ausgegeben? */
  video: boolean;
  /** Zeile zur Software mit Version und DOI; die App liefert sie, ohne sie entfällt der Absatz. */
  software?: string;
}

/** Wozu eine Datei der Ausgabe dient, am Ende des Namens erkannt. Reihenfolge zählt: Besonderes vor Allgemeinem. */
const FILE_ROLE: [RegExp, string][] = [
  [/\.mp4$/, "Montagevideo: die Aufnahmen aller Geräte auf einer Zeitachse, mit Uhrzeit, Herkunft und Montage-ID"],
  [/\.html$/, "Viewer: Einsatztranskript und Montagevideo zusammen im Browser ansehen"],
  [/_Variablen\.xlsx$/, "Dokumentvariablen für MAXQDA: die Angaben zum Einsatz"],
  [/_Begleitprotokoll\.csv$/, "Begleitprotokoll: Herkunft, Prüfsumme und Zeitbeleg jeder Datei"],
  [/_Resolve\.fcpxml$/, "Schnittliste für DaVinci Resolve: dieselbe Montage ohne Einblendungen"],
  [/\.docx$/, "Einsatztranskript: Mitschrift, Tagebuch und Fotos in zeitlicher Folge, mit Zeitmarken zum Video"],
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function tableHtml(t: MethodsTable): string {
  return (
    `<table><caption>${esc(t.caption)}</caption>` +
    `<thead><tr>${t.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  );
}

const CSS = `
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
.sub, caption, .note { color: var(--muted); }
code, .id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; }
.id { background: var(--soft); border: 1px solid var(--line); border-radius: 4px; padding: .05em .35em; white-space: nowrap; }
dl { margin: .5rem 0; }
dt { font-weight: 600; overflow-wrap: anywhere; margin-top: .6rem; }
dd { margin: 0; color: var(--muted); }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0 .5rem; font-size: .93rem; font-variant-numeric: tabular-nums; }
caption { text-align: left; font-weight: 600; color: var(--ink); padding-bottom: .3rem; }
th, td { text-align: left; vertical-align: top; padding: .3rem .9rem .3rem 0; border-bottom: 1px solid var(--line); }
th { font-weight: 500; color: var(--muted); font-size: .85rem; border-bottom-color: var(--muted); }
a { color: var(--accent); }
@media print { body { background: #fff; color: #000; } main { padding: 0; } }
`;

/** Die LIESMICH als vollständige HTML-Datei. */
export function exportReadmeHtml(transcript: SessionTranscript, opts: ReadmeOptions): string {
  const h = transcript.header;
  const numbers = methodsNumbers(transcript, opts.video);
  const tables = [materialTable([numbers]), outputTable([numbers])];
  const title = `${h.title} · ${germanDate(h.date)}`;
  const files = [...opts.files, README_NAME];
  const role = (f: string) => (f === README_NAME ? "Diese Datei" : (FILE_ROLE.find(([re]) => re.test(f))?.[1] ?? ""));
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="generator" content="Feldspur">
<meta name="feldspur-montage-id" content="${esc(h.montageId)}">
<title>LIESMICH · ${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="sub">Ausgabe eines Feldeinsatzes${h.place ? ` (${esc(h.place)})` : ""}, Montage-ID <span class="id">${esc(h.montageId)}</span>, ${esc(h.modeLabel)}</p>

<h2>Was in diesem Ordner liegt</h2>
<dl>
${files.map((f) => `<dt>${esc(f)}</dt><dd>${esc(role(f))}</dd>`).join("\n")}
</dl>

<h2>Wie die Teile zusammengehören</h2>
<p>Die Aufzeichnungen dieses Einsatzes wurden anhand ihrer Uhrzeiten auf eine gemeinsame Zeitachse gelegt. Das Einsatztranskript führt Mitschrift, Tagebucheinträge und Fotos in zeitlicher Folge; jede Zeile trägt die Uhrzeit und eine Zeitmarke der Form <code>#hh:mm:ss-z#</code>.${
    opts.video
      ? " Die Zeitmarke zeigt auf die Stelle im Montagevideo, das die Aufnahmen aller Geräte zeigt, gleichzeitige nebeneinander."
      : " Diese Ausgabe enthält kein Montagevideo; die Zeitmarken gelten für das Video, das zu dieser Montage gehört."
  }</p>
<p>Die Montage-ID hält die Fassung fest. Die ersten beiden Blöcke stehen für die Montage, also dafür, welche Quelle wo auf der Zeitachse liegt${opts.video ? "; so sind sie auch im Video eingeblendet" : ""}. Der dritte Block steht für den Wortlaut des Einsatztranskripts. Tragen zwei Ausgaben dieselbe ID, stimmen Zeitmarken und Wortlaut überein.</p>

<h2>Aus dieser Ausgabe zitieren</h2>
<p>Zitiert wird die Stelle in dieser Ausgabe: Einsatz, Datum, Uhrzeit, Zeitmarke und die ganze Montage-ID <span class="id">${esc(h.montageId)}</span>. Dazu gehört der Ort, an dem genau diese Fassung aufbewahrt wird, etwa ein Archiv mit dauerhafter Adresse. Der Ordner bleibt dafür als Ganzes und unverändert zusammen.</p>

<h2>Für den Methodenteil</h2>
<p>Was in diesen Einsatz hineingeflossen ist und was daraus ausgegeben wurde. Die Angaben sind gezählt und gemessen; den Nachweis je Datei führt das Begleitprotokoll.</p>
<div class="scroll">${tableHtml(tables[0]!)}</div>
<div class="scroll">${tableHtml(tables[1]!)}</div>
${opts.software ? `<p>${esc(opts.software)}</p>` : ""}
<p class="note">Einen Mustertext, der Montagevideo und Einsatztranskript in Worten erklärt, enthält das Handbuch im Abschnitt „Im Methodenteil beschreiben“: <a href="${METHODS_HANDBOOK_URL}">${METHODS_HANDBOOK_URL}</a></p>
</main>
</body>
</html>
`;
}
