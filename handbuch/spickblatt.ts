// Läuft nach jedem `quarto render` (post-render in _quarto.yml, mit Quartos eingebautem Deno).
// Setzt das Tastenkürzel-Spickblatt (spickblatt/tastenkuerzel.typ, eine Seite A4 quer) mit dem in Quarto
// enthaltenen Typst und legt es als Feldspur-Tastenkuerzel.pdf neben Webseite und Handbuch-PDF.
const ausgabe = Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR") ?? "_site";
const bin = Deno.env.get("QUARTO_BIN_PATH");
const quarto = bin ? `${bin}/quarto${Deno.build.os === "windows" ? ".exe" : ""}` : "quarto";

const { code, stderr } = await new Deno.Command(quarto, {
  args: [
    "typst",
    "compile",
    "--root",
    ".",
    "--font-path",
    "schriften",
    "spickblatt/tastenkuerzel.typ",
    `${ausgabe}/Feldspur-Tastenkuerzel.pdf`,
  ],
  stderr: "piped",
}).output();
if (code !== 0) {
  console.error(`Spickblatt ließ sich nicht setzen:\n${new TextDecoder().decode(stderr)}`);
  Deno.exit(1);
}
