// Läuft nach jedem `quarto render` (post-render in _quarto.yml, mit Quartos eingebautem Deno).
// Ersetzt den Zitiervorschlag am Ende der Webseite („Bitte zitieren Sie diese Arbeit als:“) durch die Fassung im
// APA-Stil aus _zitiervorschlag.html (erzeugt von stand.ts). Das Literaturverzeichnis bleibt im gewohnten Stil.
const ausgabe = Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR") ?? "_site";
const vorschlag = Deno.readTextFileSync("_zitiervorschlag.html").trim();
const datei = `${ausgabe}/index.html`;
let html: string;
try {
  html = Deno.readTextFileSync(datei);
} catch {
  Deno.exit(0); // nur PDF gebaut
}
const muster = /(<div id="ref-[^"]*" class="csl-entry quarto-appendix-citeas"[^>]*>)[\s\S]*?(<\/div>)/;
if (!muster.test(html)) {
  console.error("zitiervorschlag.ts: Zitiervorschlag in index.html nicht gefunden");
  Deno.exit(1);
}
Deno.writeTextFileSync(datei, html.replace(muster, `$1\n${vorschlag}\n$2`));
