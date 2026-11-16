// Läuft vor jedem `quarto render` (pre-render in _quarto.yml, mit Quartos eingebautem Deno).
// Zitierangaben sollen den „Stand“ tragen, weil sich Webseite und PDF laufend ändern. Quarto übernimmt den
// Zitierblock aber nur als Ganzes, deshalb entsteht _zitation.yml hier aus _zitierangaben.yml plus dem Stand im
// Feld „issue“ (Zotero liest es als „Ausgabe“). Das Datum ist dasselbe wie oben auf der Seite: der Tag des Baus.
const stand = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "Europe/Berlin" }).format(new Date());
const vorlage = Deno.readTextFileSync("_zitierangaben.yml").trimEnd();
Deno.writeTextFileSync(
  "_zitation.yml",
  `# Erzeugt von stand.ts – nicht von Hand bearbeiten, sondern _zitierangaben.yml.\n${vorlage}\n  issue: "Stand: ${stand}"\n`,
);
