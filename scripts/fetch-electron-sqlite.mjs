/**
 * Kopiert die mitgelieferte better-sqlite3-Bibliothek nach
 * apps/desktop/native/<plattform>-<arch>/.
 *
 * Seit better-sqlite3 13 nutzt die Bibliothek N-API: Dieselbe Datei läuft in Node (Tests)
 * und in Electron, ein Neubau ist nicht nötig. Die gebündelte App findet sie nur über
 * `nativeBinding` (siehe ProjectStore).
 */
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "desktop");
const require = createRequire(join(desktop, "package.json"));
const sqliteDir = dirname(require.resolve("better-sqlite3/package.json"));

const platform = process.env.npm_config_platform ?? process.platform;
const arch = process.env.npm_config_arch ?? process.arch;

const out = join(desktop, "native", `${platform}-${arch}`);
mkdirSync(out, { recursive: true });
cpSync(join(sqliteDir, "prebuilds", `${platform}-${arch}.node`), join(out, "better_sqlite3.node"));
console.log(`better-sqlite3 (${platform}-${arch}) → ${out}`);
