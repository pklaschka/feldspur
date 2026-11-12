/**
 * Lädt die vorgebaute better-sqlite3-Bibliothek für die installierte
 * Electron-Version nach apps/desktop/native/<plattform>-<arch>/.
 *
 * Hintergrund: Node (Tests) und Electron (App) haben verschiedene ABIs.
 * Statt die eine Bibliothek ständig umzubauen, bekommt Electron eine eigene
 * Kopie, die ProjectStore über `nativeBinding` lädt.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(root, "apps", "desktop");
const require = createRequire(join(desktop, "package.json"));
const electronVersion = require("electron/package.json").version;
const sqliteDir = dirname(require.resolve("better-sqlite3/package.json"));
const platform = process.env.npm_config_platform ?? process.platform;
const arch = process.env.npm_config_arch ?? process.arch;

const work = mkdtempSync(join(tmpdir(), "feldspur-native-"));
try {
  cpSync(join(sqliteDir, "package.json"), join(work, "package.json"));
  cpSync(join(sqliteDir, "binding.gyp"), join(work, "binding.gyp"));
  execFileSync(
    "npx",
    [
      "--yes",
      "prebuild-install",
      "--runtime",
      "electron",
      "--target",
      electronVersion,
      "--arch",
      arch,
      "--platform",
      platform,
    ],
    { cwd: work, stdio: "inherit", shell: process.platform === "win32" },
  );
  const out = join(desktop, "native", `${platform}-${arch}`);
  mkdirSync(out, { recursive: true });
  cpSync(join(work, "build", "Release", "better_sqlite3.node"), join(out, "better_sqlite3.node"));
  console.log(`better-sqlite3 für Electron ${electronVersion} (${platform}-${arch}) → ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
