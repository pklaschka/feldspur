// Läuft nach jedem `quarto render` (post-render in _quarto.yml, mit Quartos eingebautem Deno).
// Webseite und PDF ändern sich laufend, deshalb sollen die Zitierangaben der Webseite den „Stand“ tragen. Quarto
// kennt dafür kein Feld; dieses Skript ergänzt ihn in der fertigen index.html. Es ändert nur die Ausgabe in _site,
// keine Quelldateien (sonst würde `quarto preview` immer wieder neu rendern).
// - citation_issue: Zotero übernimmt den Stand als „Ausgabe“.
// - BibTeX im Abschnitt „Zitat“: number = {Stand: …}.
// - „Bitte zitieren Sie …“: im APA-Stil wie in Zotero. Das Literaturverzeichnis behält seinen Stil.
// Das Datum ist dasselbe wie oben auf der Seite: der Tag des Baus.
const ausgabe = Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR") ?? "_site";
const datei = `${ausgabe}/index.html`;
let html: string;
try {
  html = Deno.readTextFileSync(datei);
} catch {
  Deno.exit(0); // nur das PDF gebaut
}

const stand = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "Europe/Berlin" }).format(new Date());
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const meta = (name: string) => {
  const m = new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html);
  if (!m) throw new Error(`zitierangaben.ts: ${name} fehlt in ${datei}`);
  return m[1]!; // schon maskiert
};

function ersetzen(muster: RegExp, ersatz: string, was: string) {
  if (!muster.test(html)) throw new Error(`zitierangaben.ts: ${was} nicht gefunden`);
  html = html.replace(muster, ersatz);
}

// Läuft das Skript erneut über dieselbe Datei (etwa bei `quarto preview`), erst die eigenen Ergänzungen entfernen.
html = html
  .replace(/<meta name="citation_issue" content="[^"]*">\n/g, "")
  .replace(/^  number = \{Stand: [^}]*\},\n/gm, "");

// Zotero
ersetzen(
  /(<meta name="citation_language")/,
  `<meta name="citation_issue" content="Stand: ${esc(stand)}">\n$1`,
  "citation_language",
);

// BibTeX: nach dem Titel (der über mehrere Zeilen gehen kann)
ersetzen(
  /(<code class="sourceCode bibtex">[\s\S]*?\btitle = \{[^}]*\},\n)/,
  `$1  number = {Stand: ${esc(stand)}},\n`,
  "BibTeX-Titel",
);

// Zitiervorschlag im APA-Stil: Familienname, Initialen (Jahr). Titel (Stand: …). URL
// citation_author ist „Vorname(n) Familienname“.
const namen = meta("citation_author").split(" ");
const familie = namen.pop()!;
const initialen = namen.map((n) => `${n[0]}.`).join(" ");
const url = meta("citation_fulltext_html_url");
ersetzen(
  /(<div id="ref-[^"]*" class="csl-entry quarto-appendix-citeas"[^>]*>)[\s\S]*?(<\/div>)/,
  `$1\n${familie}, ${initialen} (${meta("citation_year")}). <em>${meta("citation_title")}</em> (Stand: ${esc(stand)}). ` +
    `<a href="${url}">${url}</a>\n$2`,
  "Zitiervorschlag",
);

// Literaturverzeichnis: „Dieselben Autor*innen wie oben“ setzt der Zitierstil als drei Geviertstriche (———), die im
// Browser mit Lücken dazwischen ausfransen. Wie im PDF (kopf.typ) wird daraus eine durchgehende Linie (stil.scss).
// Citeproc läuft nach den Lua-Filtern, deshalb erst hier.
html = html.replace(
  /(class="csl-entry"[^>]*>\n?)———/g,
  '$1<span class="wie-oben" role="img" aria-label="dieselben Autor*innen wie im Eintrag davor"></span>',
);

Deno.writeTextFileSync(datei, html);
