// Läuft vor jedem `quarto render` (pre-render in _quarto.yml, mit Quartos eingebautem Deno).
// Zitierangaben sollen den „Stand“ tragen, weil sich Webseite und PDF laufend ändern. Das Datum ist dasselbe wie oben
// auf der Seite: der Tag des Baus.
// - _zitation.yml: Quarto übernimmt den Zitierblock nur als Ganzes, also _zitierangaben.yml plus Stand im Feld
//   „number“ (im BibTeX als number).
// - _stand-kopf.html: citation_issue für Zotero („Ausgabe“); aus „number“ macht Quarto kein Meta-Tag.
// - _zitiervorschlag.html: „Bitte zitieren Sie …“ im APA-Stil wie in Zotero. Quarto setzt den Vorschlag sonst im
//   Stil des Literaturverzeichnisses; das soll so bleiben, deshalb tauscht zitiervorschlag.ts nur diesen Eintrag.
const stand = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "Europe/Berlin" }).format(new Date());
const vorlage = Deno.readTextFileSync("_zitierangaben.yml").trimEnd();
Deno.writeTextFileSync(
  "_zitation.yml",
  `# Erzeugt von stand.ts – nicht von Hand bearbeiten, sondern _zitierangaben.yml.\n${vorlage}\n  number: "Stand: ${stand}"\n`,
);
Deno.writeTextFileSync("_stand-kopf.html", `<meta name="citation_issue" content="Stand: ${stand}">\n`);

// Angaben aus den YAML-Dateien; einfache Zeilen, deshalb reicht ein Muster statt eines YAML-Parsers.
const feld = (text: string, name: string) => {
  const m = new RegExp(`^\\s*${name}:\\s*"?([^"\\n]+)"?\\s*$`, "m").exec(text);
  if (!m) throw new Error(`stand.ts: Feld „${name}“ fehlt`);
  return m[1]!.trim();
};
const metadaten = Deno.readTextFileSync("_metadaten.yml");
const initialen = feld(metadaten, "given")
  .split(/\s+/)
  .map((n) => `${n[0]}.`)
  .join(" ");
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const jahr = feld(vorlage, "issued").slice(0, 4);
const url = feld(vorlage, "url");
Deno.writeTextFileSync(
  "_zitiervorschlag.html",
  `${esc(feld(metadaten, "family"))}, ${initialen} (${jahr}). <em>${esc(feld(vorlage, "title"))}</em> (Stand: ${stand}). ` +
    `<a href="${esc(url)}">${esc(url)}</a>\n`,
);
