import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { defineConfig, type UserConfig } from "vite-plus";

type PackConfig = Extract<NonNullable<UserConfig["pack"]>, unknown[]>[number];

// Renderer: `vp build` / `vp dev` (Wurzel src/renderer).
// Haupt- und Preload-Prozess: `vp pack` (tsdown), beide als CommonJS, weil
// sandboxed Preloads kein ESM können. Die Workspace-Pakete liegen als
// TypeScript vor und werden deshalb mit eingebündelt.
// Erscheinungsdatum der Version für „Feldspur zitieren“: setzt der Release-Workflow in CITATION.cff.
const released = /^date-released:\s*"?(\d{4}-\d{2}-\d{2})"?/m.exec(
  readFileSync(new URL("../../CITATION.cff", import.meta.url), "utf8"),
)?.[1];
if (!released) throw new Error("CITATION.cff: date-released fehlt");

const shared: PackConfig = {
  outDir: "out/main",
  define: { __FELDSPUR_RELEASED__: JSON.stringify(released) },
  format: "cjs",
  platform: "node",
  target: "node22",
  dts: false,
  deps: {
    alwaysBundle: [/^@feldspur\//, "better-sqlite3", "bindings", "file-uri-to-path"],
    // Die gebündelten Abhängigkeiten sind für die eigenständige Electron-Ausgabe beabsichtigt.
    onlyBundle: false,
    // better-sqlite3 wird mit eingebündelt; die native Bibliothek kommt immer über nativeBinding.
    neverBundle: ["electron"],
  },
};

export default defineConfig({
  root: "src/renderer",
  base: "./",
  // Tailwind bringt die Plugin-Typen des normalen Vite mit; zur Laufzeit passen sie zu Vite+.
  plugins: [tailwindcss() as unknown as NonNullable<UserConfig["plugins"]>[number]],
  build: {
    outDir: "../../out/renderer",
    emptyOutDir: true,
    // Der PDF-Worker ist absichtlich größer als Vites Standard-Schwelle.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      onLog(level, log, defaultHandler) {
        if (level === "warn" && log.code === "MODULE_LEVEL_DIRECTIVE" && log.message.includes('"use client"')) {
          return;
        }
        defaultHandler(level, log);
      },
    },
  },
  pack: [
    { ...shared, entry: { main: "src/main/main.ts" }, clean: true },
    // Eigener Durchlauf, damit der Preload eine einzige Datei ohne require() auf Nachbardateien bleibt.
    { ...shared, entry: { preload: "src/preload/preload.ts" }, clean: false },
  ],
});
