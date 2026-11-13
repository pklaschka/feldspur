/**
 * Baut das Installationspaket der Desktop-App mit electron-builder.
 *
 * Voraussetzungen (für die Zielplattform):
 *   pnpm --filter @feldspur/desktop build     App gebaut nach apps/desktop/out
 *   pnpm --filter @feldspur/desktop native    better-sqlite3 für Electron
 *   node scripts/fetch-ffmpeg.mjs             ffmpeg/ffprobe (LGPL)
 *
 *   node scripts/package-desktop.mjs [--dir]  --dir: nur entpackt, ohne Installer
 *
 * Das Paket enthält keine node_modules: Haupt- und Preload-Prozess sind fertig gebündelt
 * (inkl. better-sqlite3), die native Bibliothek und FFmpeg liegen unter resources/.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const electronVersion = require("electron/package.json").version;

const need = (p, hint) => {
  if (!existsSync(p)) throw new Error(`Fehlt: ${p}\n→ ${hint}`);
  return p;
};
need(join(desktop, "out", "main", "main.cjs"), "pnpm --filter @feldspur/desktop build");
const binding = need(join(desktop, "native", key, "better_sqlite3.node"), "pnpm --filter @feldspur/desktop native");
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
      version: rootPkg.version,
      description: rootPkg.description,
      main: "out/main/main.cjs",
      license: rootPkg.license,
      author: "Feldspur",
    },
    null,
    2,
  ),
);

// Ressourcen neben der App: native Bibliothek, FFmpeg, Lizenzen.
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
    copyright: "Feldspur",
    electronVersion,
    directories: { output: join(release, "dist") },
    files: ["out/**/*", "package.json"],
    asar: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    extraResources: [{ from: res, to: ".", filter: ["**/*"] }],
    fileAssociations: [{ ext: "feldspur", name: "Feldspur-Projekt", role: "Editor" }],
    artifactName: "Feldspur-${version}-${os}-${arch}.${ext}",
    mac: {
      category: "public.app-category.education",
      // Noch keine Signatur: macOS fragt beim ersten Start nach („Trotzdem öffnen“).
      identity: null,
    },
    win: {},
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
    linux: { category: "Science", maintainer: "Feldspur" },
  },
});
console.log(files.map((f) => `→ ${f}`).join("\n"));
