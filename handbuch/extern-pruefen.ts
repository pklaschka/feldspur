// Läuft nach jedem `quarto render` (post-render in _quarto.yml, mit Quartos eingebautem Deno).
// Die Webseite darf nichts von fremden Servern laden: keine CDNs, keine Webfonts, keine fremden Skripte.
// Findet sich so etwas in den erzeugten Dateien, bricht der Bau ab.
const ausgabe = Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR") ?? "_site";
const muster =
  /(src|href)=["']https?:\/\/[^"']+\.(js|css|woff2?|ttf|otf)["']|<script[^>]+src=["']https?:|@import url\(["']?https?:/;
const fehler: string[] = [];

function durchsuchen(ordner: string) {
  for (const e of Deno.readDirSync(ordner)) {
    const pfad = `${ordner}/${e.name}`;
    if (e.isDirectory) durchsuchen(pfad);
    else if (/\.(html|css|js)$/.test(e.name) && muster.test(Deno.readTextFileSync(pfad))) fehler.push(pfad);
  }
}

durchsuchen(ausgabe);
if (fehler.length) {
  console.error(`Externe Ressourcen in der Webseite:\n${fehler.join("\n")}`);
  Deno.exit(1);
}
