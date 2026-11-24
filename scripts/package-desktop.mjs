/**
 * Baut das Installationspaket der Desktop-App mit electron-builder.
 *
 * Voraussetzungen (für die Zielplattform):
 *   vp run @feldspur/desktop#build            App gebaut nach apps/desktop/out
 *   vp run @feldspur/desktop#native           better-sqlite3 bereitstellen
 *   node scripts/fetch-ffmpeg.mjs             ffmpeg/ffprobe (LGPL)
 *
 *   node scripts/package-desktop.mjs [--dir]  --dir: nur entpackt, ohne Installer
 *
 * FELDSPUR_VERSION überschreibt die Version aus package.json (Probelauf des Release-Workflows).
 *
 * Das Paket enthält keine node_modules: Haupt- und Preload-Prozess sind fertig gebündelt
 * (inkl. better-sqlite3), die native Bibliothek und FFmpeg liegen unter resources/.
 *
 * Läuft im Paket-Workflow (.github/workflows/package.yml), den auch der Release-Workflow aufruft. Ergebnis:
 * apps/desktop/release/dist.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { macDocumentTypes, PROJECT_ICON_FILE } from "./mac-document-type.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps", "desktop");
const require = createRequire(join(desktop, "package.json"));
const { build, Platform } = require("electron-builder");

const platform = process.env.npm_config_platform ?? process.platform;
const arch = process.env.npm_config_arch ?? process.arch;
const key = `${platform}-${arch}`;
const exe = platform === "win32" ? ".exe" : "";
const dirOnly = process.argv.includes("--dir");

const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = process.env.FELDSPUR_VERSION || rootPkg.version;
const electronVersion = require("electron/package.json").version;

// Fehlt eine Voraussetzung, bricht das Skript mit dem Befehl ab, der sie herstellt.
const need = (p, hint) => {
  if (!existsSync(p)) throw new Error(`Fehlt: ${p}\n→ ${hint}`);
  return p;
};
need(join(desktop, "out", "main", "main.cjs"), "vp run @feldspur/desktop#build");
const binding = need(join(desktop, "native", key, "better_sqlite3.node"), "vp run @feldspur/desktop#native");
const ffmpegDir = join(desktop, "vendor", "ffmpeg", key);
for (const t of ["ffmpeg", "ffprobe"]) need(join(ffmpegDir, `${t}${exe}`), "node scripts/fetch-ffmpeg.mjs");

const release = join(desktop, "release");
const stage = join(release, "stage");
const res = join(release, "resources");
rmSync(release, { recursive: true, force: true });

// App: nur der gebaute Code und eine schlanke package.json.
cpSync(join(desktop, "out"), join(stage, "out"), { recursive: true });
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "feldspur",
      productName: "Feldspur",
      version,
      description: rootPkg.description,
      main: "out/main/main.cjs",
      license: rootPkg.license,
      author: "Zuri Nimca Klaschka",
    },
    null,
    2,
  ),
);

// Ressourcen neben der App: native Bibliothek, FFmpeg, Lizenzen, App-Symbol.
mkdirSync(join(res, "native"), { recursive: true });
cpSync(binding, join(res, "native", "better_sqlite3.node"));
mkdirSync(join(res, "bin"), { recursive: true });
for (const t of ["ffmpeg", "ffprobe"]) cpSync(join(ffmpegDir, `${t}${exe}`), join(res, "bin", `${t}${exe}`));
mkdirSync(join(res, "licenses"), { recursive: true });
for (const [from, to] of [
  ["LICENSE.txt", "FFmpeg-LICENSE.txt"],
  ["BUILD.txt", "FFmpeg-BUILD.txt"],
]) {
  if (existsSync(join(ffmpegDir, from))) cpSync(join(ffmpegDir, from), join(res, "licenses", to));
}
cpSync(join(root, "packaging", "THIRD-PARTY.md"), join(res, "licenses", "THIRD-PARTY.md"));
// Feldspur selbst: EUPL-1.2, englische und deutsche Sprachfassung (beide gleichermaßen verbindlich).
cpSync(join(root, "LICENSE"), join(res, "licenses", "Feldspur-LICENSE.txt"));
cpSync(join(root, "LIZENZ"), join(res, "licenses", "Feldspur-LIZENZ.txt"));
const icon = join(root, "packaging", "icon.png");
cpSync(icon, join(res, "icon.png"));
if (platform === "darwin") cpSync(join(root, "packaging", PROJECT_ICON_FILE), join(res, PROJECT_ICON_FILE));

const association = { ext: "feldspur", name: "Feldspur-Projekt", description: "Feldspur-Projekt", role: "Editor" };

const targets = {
  darwin: Platform.MAC.createTarget(dirOnly ? "dir" : ["dmg", "zip"]),
  win32: Platform.WINDOWS.createTarget(dirOnly ? "dir" : ["nsis"]),
  linux: Platform.LINUX.createTarget(dirOnly ? "dir" : ["AppImage", "tar.gz"]),
}[platform];
if (!targets) throw new Error(`Unbekannte Plattform ${platform}`);

const files = await build({
  targets,
  publish: "never",
  projectDir: stage,
  config: {
    appId: "app.feldspur.desktop",
    productName: "Feldspur",
    copyright: "© 2026 Zuri Nimca Klaschka, lizenziert unter der EUPL-1.2",
    electronVersion,
    directories: { output: join(release, "dist") },
    files: ["out/**/*", "package.json"],
    asar: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    extraResources: [{ from: res, to: ".", filter: ["**/*"] }],
    // Doppelklick auf eine Projektdatei öffnet Feldspur, mit eigenem Dateisymbol (packaging/datei-icon.svg).
    // Das Symbol braucht je System ein eigenes Format, deshalb stehen die Zuordnungen bei mac, win und linux.
    artifactName: "Feldspur-${version}-${os}-${arch}.${ext}",
    // Aus dem 1024er PNG erzeugt electron-builder .icns (macOS) und .ico (Windows).
    icon,
    mac: {
      category: "public.app-category.education",
      // Noch keine Signatur: macOS fragt beim ersten Start nach („Trotzdem öffnen“).
      identity: null,
      // Dokumenttyp mit eigenem Typ (UTI) statt fileAssociations, sonst zeigt Finder kein Symbol
      // (Issue #165, siehe scripts/mac-document-type.mjs). Das Symbol kommt über extraResources mit.
      extendInfo: macDocumentTypes(),
    },
    win: { fileAssociations: [{ ...association, icon: join(root, "packaging", "datei-icon.ico") }] },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
    linux: {
      category: "Science",
      maintainer: "Zuri Nimca Klaschka",
      icon,
      fileAssociations: [{ ...association, mimeType: "application/x-feldspur" }],
    },
  },
});
console.log(files.map((f) => `→ ${f}`).join("\n"));
