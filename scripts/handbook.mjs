/**
 * Baut Begleittext und Handbuch (Quarto-Manuskript in handbuch/) und die README.
 *
 *   node scripts/handbook.mjs            Webseite nach handbuch/_site/ (mit PDF) und
 *                                        PDF nach dist/handbuch/Feldspur-Handbuch-<version>.pdf
 *   node scripts/handbook.mjs --readme   nur README.md aus README.qmd neu erzeugen
 *   node scripts/handbook.mjs --readme --check   README.md nur prüfen (Fehler, wenn sie nicht zu den Quellen passt)
 *
 * FELDSPUR_VERSION setzt die Version im Dateinamen (leer = aus package.json), QUARTO den Pfad zu quarto.
 * Das PDF setzt das in Quarto enthaltene Typst; LaTeX ist nicht nötig.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "handbuch");
const quarto = process.env.QUARTO || "quarto";
const version =
  process.env.FELDSPUR_VERSION?.replace(/^v/, "") ||
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const args = process.argv.slice(2);

function run(cmd, argv, cwd) {
  execFileSync(cmd, argv, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

/** README.md aus README.qmd; danach wie alle Markdown-Dateien mit vp fmt formatieren. */
function buildReadme() {
  const before = readFileSync(join(root, "README.md"), "utf8");
  run(quarto, ["render", "README.qmd"], root);
  run("vp", ["fmt", "README.md"], root);
  const after = readFileSync(join(root, "README.md"), "utf8");
  if (args.includes("--check") && after !== before) {
    console.error(
      "README.md passt nicht zu README.qmd und handbuch/. Bitte `node scripts/handbook.mjs --readme` ausführen.",
    );
    process.exit(1);
  }
  console.log("README.md erzeugt.");
}

/** Die Webseite darf nichts von fremden Servern laden (keine CDNs, keine Webfonts). */
function checkNoExternal(dir) {
  const pattern =
    /(src|href)=["']https?:\/\/[^"']+\.(js|css|woff2?|ttf|otf)["']|<script[^>]+src=["']https?:|@import url\(["']?https?:/;
  const bad = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|css|js)$/.test(e.name) && pattern.test(readFileSync(p, "utf8"))) bad.push(p);
    }
  };
  walk(dir);
  if (bad.length) throw new Error(`Externe Ressourcen in der Webseite:\n${bad.join("\n")}`);
}

/** Webseite und PDF in einem Durchlauf; das PDF landet zusätzlich versioniert in dist/handbuch/. */
function buildManuscript() {
  rmSync(join(src, "_site"), { recursive: true, force: true });
  run(quarto, ["render"], src);
  const out = join(root, "dist", "handbuch");
  mkdirSync(out, { recursive: true });
  const pdf = join(out, `Feldspur-Handbuch-${version}.pdf`);
  cpSync(join(src, "_site", "Feldspur-Handbuch.pdf"), pdf);
  console.log(`PDF: ${pdf}`);
  checkNoExternal(join(src, "_site"));
  console.log(`Webseite: ${join(src, "_site")}`);
}

if (args.includes("--readme")) buildReadme();
else buildManuscript();
