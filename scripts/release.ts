/**
 * Hilfen für den Release-Workflow (.github/workflows/release.yml). Nur die App bekommt Versionen,
 * Tags und ein Changelog; packages/* laufen ohne eigene Releases mit.
 *
 *   vpx scripts/release.ts check <version>                 Version gültig, neu und größer als alle bisherigen?
 *   vpx scripts/release.ts previous-tag <version>          Tag, ab dem die Änderungen gesammelt werden
 *   vpx scripts/release.ts prepare <version> <notes.md>    Versionen, CITATION.cff, .zenodo.json und CHANGELOG.md setzen
 *   vpx scripts/release.ts body <version> <out.md>         Text der GitHub-Release aus CHANGELOG.md
 *
 * Versionen: 1.2.3 (Release) oder 1.2.3-alpha.1 / -beta.1 / -rc.1 (Vorabversion). Tags heißen v<version>.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** z. B. ["rc", 1]; leer bei einem Release. */
  pre: [string, number] | null;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/;
const PRE_ORDER = ["alpha", "beta", "rc"];

export function parseVersion(text: string): Version {
  const m = VERSION_RE.exec(text.trim().replace(/^v/, ""));
  if (!m) throw new Error(`„${text}“ ist keine gültige Version (z. B. 0.2.0 oder 0.2.0-rc.1)`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? [m[4], Number(m[5])] : null,
  };
}

export const isPrerelease = (v: string): boolean => parseVersion(v).pre !== null;

/** Semver-Reihenfolge: 0.2.0-alpha.1 < 0.2.0-rc.1 < 0.2.0 < 0.2.1. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  const core = x.major - y.major || x.minor - y.minor || x.patch - y.patch;
  if (core !== 0) return core;
  if (!x.pre || !y.pre) return (x.pre ? -1 : 0) - (y.pre ? -1 : 0);
  return PRE_ORDER.indexOf(x.pre[0]) - PRE_ORDER.indexOf(y.pre[0]) || x.pre[1] - y.pre[1];
}

/** Nur Tags, die wie App-Versionen aussehen (v1.2.3, v1.2.3-rc.1), aufsteigend sortiert. */
export function versionTags(tags: string[]): string[] {
  return tags
    .map((t) => t.trim())
    .filter((t) => t.startsWith("v") && VERSION_RE.test(t.slice(1)))
    .sort((a, b) => compareVersions(a, b));
}

/** Gegen welchen Tag sammeln? Release: letztes Release (fasst alle Vorabversionen zusammen). Vorabversion: letzter Tag. */
export function previousTag(tags: string[], version: string): string | null {
  const final = !isPrerelease(version);
  const older = versionTags(tags).filter((t) => compareVersions(t, version) < 0 && (!final || !isPrerelease(t)));
  return older.at(-1) ?? null;
}

export function checkNewVersion(tags: string[], version: string): void {
  parseVersion(version);
  const known = versionTags(tags);
  if (known.includes(`v${version}`)) throw new Error(`Tag v${version} gibt es schon`);
  const newest = known.at(-1);
  if (newest && compareVersions(version, newest) < 0) {
    throw new Error(`${version} ist kleiner als die neueste Version ${newest.slice(1)}`);
  }
}

/**
 * GitHubs automatische Release-Notizen (generate-notes) ins Changelog-Format bringen:
 * englische Überschrift weg, Kategorien eine Ebene tiefer, PR-Links kurz.
 */
export function tidyGeneratedNotes(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let line of lines) {
    if (/^##\s+What's Changed\s*$/.test(line)) continue;
    if (line.startsWith("**Full Changelog**")) {
      line = line.replace("**Full Changelog**", "**Alle Änderungen**");
    }
    line = line.replace(/^##\s+New Contributors\s*$/, "### Neu dabei");
    line = line.replace(/^\*\s+/, "- ");
    line = line.replace(
      / by (@[\w-]+(?:\[bot\])?) in (https:\/\/github\.com\/[^\s]+\/pull\/(\d+))$/,
      " ([#$3]($2), $1)",
    );
    line = line.replace(/ made their first contribution in /, " hat zum ersten Mal beigetragen: ");
    out.push(line);
  }
  const text = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const hasEntries = /^- /m.test(text);
  return hasEntries ? text : `Keine über Pull Requests erfassten Änderungen.\n\n${text}`.trim();
}

const CHANGELOG_HEAD = `# Changelog

Änderungen an der Feldspur-App. Die Einträge entstehen beim Release automatisch aus den Titeln der
zusammengeführten Pull Requests (siehe \`.github/release.yml\` für die Rubriken). Vorabversionen (\`-rc.N\` usw.)
werden beim zugehörigen Release zu einem Abschnitt zusammengefasst.
`;

/** Neuen Abschnitt oben einfügen; bei einem Release die Abschnitte seiner Vorabversionen ersetzen. */
export function updateChangelog(current: string | null, version: string, date: string, notes: string): string {
  const text = (current ?? CHANGELOG_HEAD).replace(/\r\n/g, "\n");
  const firstSection = text.search(/^## /m);
  const head = (firstSection === -1 ? text : text.slice(0, firstSection)).trimEnd();
  const rest = firstSection === -1 ? "" : text.slice(firstSection);
  const sections = rest.split(/^(?=## )/m).filter((s) => s.trim() !== "");

  const base = version.replace(/-.*/, "");
  const keep = sections.filter((s) => {
    const v = /^## \[?v?([^\]\s]+)/.exec(s)?.[1];
    if (!v) return true;
    if (v === version) return false;
    return isPrerelease(version) || !(v.startsWith(`${base}-`) && VERSION_RE.test(v));
  });
  const label = isPrerelease(version) ? " (Vorabversion)" : "";
  const section = `## ${version} – ${date}${label}\n\n${notes.trim()}\n`;
  return [head, section, ...keep.map((s) => s.trimEnd() + "\n")].join("\n\n").replace(/\n{3,}/g, "\n\n");
}

/** Text wörtlich in einem regulären Ausdruck verwenden. */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Den Abschnitt einer Version aus CHANGELOG.md holen. */
export function changelogSection(changelog: string, version: string): string {
  const sections = changelog.replace(/\r\n/g, "\n").split(/^(?=## )/m);
  const hit = sections.find((s) => new RegExp(`^## \\[?v?${escapeRegExp(version)}[\\]\\s]`).test(s));
  if (!hit) throw new Error(`Kein Abschnitt für ${version} in CHANGELOG.md`);
  return hit.replace(/^## .*\n/, "").trim();
}

export function releaseBody(version: string, notes: string, repo: string): string {
  const pre = isPrerelease(version);
  const intro = pre
    ? `> [!WARNING]\n> **Vorabversion zum Testen.** Bitte nicht für laufende Auswertungen verwenden und Projektdateien vorher sichern.`
    : `> [!NOTE]\n> Feldspur ist ein Forschungswerkzeug, (noch) kein Produkt: keine stabilen Formate, kein Support. Siehe README.`;
  return `${intro}

${notes}

### Herunterladen

| System | Datei |
| --- | --- |
| Windows | \`Feldspur-${version}-win-x64.exe\` (Installer) |
| macOS (Apple-Chip) | \`Feldspur-${version}-mac-arm64.dmg\` |
| macOS (Intel) | \`Feldspur-${version}-mac-x64.dmg\` |
| Linux | \`Feldspur-${version}-linux-x86_64.AppImage\` oder \`.tar.gz\` |

Die Pakete sind noch nicht signiert: macOS fragt beim ersten Start nach („Rechtsklick → Öffnen“), Windows zeigt
eine SmartScreen-Warnung. Prüfsummen stehen in \`SHA256SUMS.txt\`. Liegt ein \`Feldspur-Handbuch-*.pdf\` bei, ist
es das Handbuch zu genau dieser Version; die Fassung \`…-Druck.pdf\` hat 3 mm Beschnitt für die Druckerei.

Lizenz: [EUPL-1.2](https://github.com/${repo}/blob/v${version}/LICENSE). Zitieren: siehe
[CITATION.cff](https://github.com/${repo}/blob/v${version}/CITATION.cff) bzw. den Zenodo-Datensatz dieser Version.
`;
}

/** Datum wie im README-Kopf und im Handbuch („D. MMMM YYYY“, deutsch), z. B. 16. November 2026. */
export function germanDate(isoDate: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/**
 * Versionen in den Dateien setzen, die eine tragen. packages/* bleiben unverändert.
 * Außer den Metadaten (package.json, CITATION.cff, .zenodo.json) auch die Zitierbeispiele im Handbuch
 * (handbuch/_zitieren.qmd) und den „Stand“ der README (README.qmd). README.md wird gleich mitgezogen, so wie
 * `vp run readme` es erzeugen würde; die CI-Prüfung (README passt zu den Bausteinen) bleibt damit grün.
 */
export function bumpFiles(root: string, version: string, date: string): string[] {
  const touched: string[] = [];
  const edit = (rel: string, fn: (s: string) => string) => {
    const p = join(root, rel);
    const before = readFileSync(p, "utf8");
    const after = fn(before);
    if (after !== before) {
      writeFileSync(p, after);
      touched.push(rel);
    }
  };
  const jsonVersion = (s: string) => s.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  edit("package.json", jsonVersion);
  edit("apps/desktop/package.json", jsonVersion);
  edit(".zenodo.json", jsonVersion);
  // Zitierbeispiele: „(Version x)“ für das Programm, „(Stand: …)“ für den Text, in Baustein und erzeugter README.
  const citeExamples = (s: string) =>
    s
      .replace(/\(Version [^)\s]+\)/g, `(Version ${version})`)
      .replace(/\(Stand: [^)]+\)/g, `(Stand: ${germanDate(date)})`);
  edit("handbuch/_zitieren.qmd", citeExamples);
  edit("README.qmd", (s) => s.replace(/^date: .*$/m, `date: ${date}`));
  edit("README.md", (s) => citeExamples(s).replace(/^Stand: .*$/m, `Stand: ${germanDate(date)}`));
  edit("CITATION.cff", (s) => {
    let t = s.replace(/^version:.*$/m, `version: ${version}`);
    t = /^date-released:/m.test(t)
      ? t.replace(/^date-released:.*$/m, `date-released: "${date}"`)
      : t.replace(/^(version:.*)$/m, `$1\ndate-released: "${date}"`);
    return t;
  });
  return touched;
}

function gitTags(root: string): string[] {
  return execFileSync("git", ["tag", "--list", "v*"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
}

function main(argv: string[]): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [cmd, version, file] = argv;
  if (!cmd || !version) throw new Error("Aufruf: release.ts check|previous-tag|prepare|body <version> [datei]");
  const v = version.replace(/^v/, "");
  switch (cmd) {
    case "check":
      checkNewVersion(gitTags(root), v);
      console.log(`${v} ist neu (${isPrerelease(v) ? "Vorabversion" : "Release"})`);
      break;
    case "previous-tag":
      console.log(previousTag(gitTags(root), v) ?? "");
      break;
    case "prepare": {
      if (!file) throw new Error("prepare braucht die Datei mit den Notizen");
      const date = new Date().toISOString().slice(0, 10);
      const notes = tidyGeneratedNotes(readFileSync(file, "utf8"));
      const changelogPath = join(root, "CHANGELOG.md");
      let current: string | null = null;
      try {
        current = readFileSync(changelogPath, "utf8");
      } catch {
        current = null;
      }
      writeFileSync(changelogPath, updateChangelog(current, v, date, notes));
      console.log(["CHANGELOG.md", ...bumpFiles(root, v, date)].join("\n"));
      break;
    }
    case "body": {
      if (!file) throw new Error("body braucht die Ausgabedatei");
      const repo = process.env.GITHUB_REPOSITORY ?? "pklaschka/feldspur";
      const notes = changelogSection(readFileSync(join(root, "CHANGELOG.md"), "utf8"), v);
      writeFileSync(file, releaseBody(v, notes, repo));
      break;
    }
    default:
      throw new Error(`Unbekannter Befehl ${cmd}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`::error::${(e as Error).message}`);
    process.exit(1);
  }
}
