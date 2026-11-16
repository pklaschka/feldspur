// Läuft vor jedem `quarto render` (pre-render in _quarto.yml, mit Quartos eingebautem Deno).
// Zitierangaben sollen den „Stand“ tragen, weil sich Webseite und PDF laufend ändern. Das Datum ist dasselbe wie oben
// auf der Seite: der Tag des Baus.
// - _zitation.yml: Quarto übernimmt den Zitierblock nur als Ganzes, also _zitierangaben.yml plus Stand im Feld
//   „number“. Daraus setzt der APA-Stil „(Stand: …)“ hinter den Titel, im BibTeX steht es als number.
// - _stand-kopf.html: citation_issue für Zotero („Ausgabe“); aus „number“ macht Quarto kein Meta-Tag.
const stand = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "Europe/Berlin" }).format(new Date());
const vorlage = Deno.readTextFileSync("_zitierangaben.yml").trimEnd();
Deno.writeTextFileSync(
  "_zitation.yml",
  `# Erzeugt von stand.ts – nicht von Hand bearbeiten, sondern _zitierangaben.yml.\n${vorlage}\n  number: "Stand: ${stand}"\n`,
);
Deno.writeTextFileSync("_stand-kopf.html", `<meta name="citation_issue" content="Stand: ${stand}">\n`);
