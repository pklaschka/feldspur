/**
 * Baut Handbuch und Begleittext aus handbuch/ mit Quarto.
 *
 *   node scripts/handbook.mjs            PDF nach dist/handbuch/Feldspur-Handbuch-<version>.pdf
 *   node scripts/handbook.mjs --site     zusätzlich die Webseite nach handbuch/_site/ (mit dem PDF darin)
 *
 * FELDSPUR_VERSION setzt die Version (leer = aus package.json), QUARTO den Pfad zu quarto.
 *
 * Quarto-Bücher kennen kein Typst. Für das PDF fügt das Skript die Kapitel deshalb in eine einzige
 * Datei zusammen und setzt sie mit dem in Quarto enthaltenen Typst. So braucht es kein LaTeX.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "handbuch");
const quarto = process.env.QUARTO || "quarto";
const version =
  process.env.FELDSPUR_VERSION?.replace(/^v/, "") ||
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const site = process.argv.includes("--site");

/** Kapitelfolge aus _quarto.yml: Teile („part“) und .qmd-Dateien in der Reihenfolge des Buchs. */
function outline() {
  const yml = readFileSync(join(src, "_quarto.yml"), "utf8");
  const items = [];
  for (const line of yml.split("\n")) {
    const part = line.match(/^\s*- part:\s*"?([^"]+)"?\s*$/);
    const file = line.match(/^\s*-\s+([\w-]+\.qmd)\s*$/);
    if (part) items.push({ part: part[1] });
    else if (file) items.push({ file: file[1] });
  }
  return items;
}

const BOX_OPEN =
  "```{=typst}\n#block(fill: luma(244), stroke: (left: 3pt + luma(150)), inset: 10pt, width: 100%, breakable: true)[\n```";
const BOX_CLOSE = "```{=typst}\n]\n```";

/**
 * Hinweiskästen (Callouts) als schlichte Kästen setzen. Quartos eigene Typst-Kästen laden ein
 * Symbolpaket aus dem Netz nach; so bleibt der PDF-Satz ohne Netz und ohne Fremdpakete.
 */
function boxCallouts(path) {
  const text = readFileSync(path, "utf8").replace(
    /^::: \{\.callout-\w+\}\n(?:## (.+)\n)?([\s\S]*?)^:::$/gm,
    (_, title, body) => `${BOX_OPEN}\n\n${title ? `**${title}**\n\n` : ""}${body.trim()}\n\n${BOX_CLOSE}`,
  );
  writeFileSync(path, text);
}

function buildPdf() {
  const work = mkdtempSync(join(tmpdir(), "feldspur-handbuch-"));
  try {
    cpSync(src, work, {
      recursive: true,
      filter: (p) => !/[/\\](_site|\.quarto)$/.test(p) && !p.endsWith("_quarto.yml"),
    });
    for (const x of outline()) if (x.file) boxCallouts(join(work, x.file));
    const body = outline().map((x) =>
      x.part
        ? `\`\`\`{=typst}\n#pagebreak(weak: true)\n#align(center + horizon, text(size: 22pt, weight: "bold")[${x.part}])\n#pagebreak()\n\`\`\``
        : `{{< include ${x.file} >}}`,
    );
    const front = [
      "---",
      'title: "Feldspur"',
      `subtitle: "Handbuch und Begleittext · Version ${version}"`,
      // Ohne „orcid“-Feld: das zöge im Typst-Satz ein Symbolpaket aus dem Netz nach.
      'author: "Zuri Nimca Klaschka (ORCID 0009-0005-9995-5687)"',
      `date: "${new Date().toISOString().slice(0, 10)}"`,
      'date-format: "D. MMMM YYYY"',
      "lang: de",
      "format:",
      "  typst:",
      "    papersize: a4",
      "    toc: true",
      "    toc-depth: 2",
      '    toc-title: "Inhalt"',
      '    section-numbering: "1.1"',
      "    output-file: Feldspur-Handbuch.pdf",
      "crossref:",
      "  fig-title: Abbildung",
      "  fig-prefix: Abbildung",
      "---",
      "",
    ].join("\n");
    writeFileSync(join(work, "Feldspur-Handbuch.qmd"), front + body.join("\n\n") + "\n");
    execFileSync(quarto, ["render", "Feldspur-Handbuch.qmd"], { cwd: work, stdio: "inherit" });

    const out = join(root, "dist", "handbuch");
    mkdirSync(out, { recursive: true });
    const pdf = join(out, `Feldspur-Handbuch-${version}.pdf`);
    cpSync(join(work, "Feldspur-Handbuch.pdf"), pdf);
    console.log(`PDF: ${pdf}`);
    return pdf;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Die Webseite darf nichts von fremden Servern laden (keine CDNs, keine Webfonts). */
function checkNoExternal(dir) {
  const bad = execFileSync(
    "grep",
    ["-rlE", String.raw`(src|href)=["']https?://[^"']+\.(js|css|woff2?|ttf)|@import url\(["']?https?:`, dir],
    { encoding: "utf8" },
  ).trim();
  if (bad) throw new Error(`Externe Ressourcen in der Webseite:\n${bad}`);
}

const pdf = buildPdf();
if (site) {
  execFileSync(quarto, ["render"], { cwd: src, stdio: "inherit", env: { ...process.env, FELDSPUR_VERSION: version } });
  cpSync(pdf, join(src, "_site", "Feldspur-Handbuch.pdf"));
  try {
    checkNoExternal(join(src, "_site"));
  } catch (e) {
    // grep endet mit 1, wenn nichts gefunden wurde: das ist der gute Fall.
    if (e.status !== 1) throw e;
  }
  console.log(`Webseite: ${join(src, "_site")}`);
}
