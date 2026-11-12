import { defineConfig, type UserConfig } from "vite-plus";

type PackConfig = Extract<NonNullable<UserConfig["pack"]>, unknown[]>[number];

// Renderer: `vp build` / `vp dev` (Wurzel src/renderer).
// Haupt- und Preload-Prozess: `vp pack` (tsdown), beide als CommonJS, weil
// sandboxed Preloads kein ESM können. Die Workspace-Pakete liegen als
// TypeScript vor und werden deshalb mit eingebündelt.
const shared: PackConfig = {
  outDir: "out/main",
  format: "cjs",
  platform: "node",
  target: "node22",
  dts: false,
  noExternal: [/^@feldspur\//],
  external: ["electron", "better-sqlite3"],
};

export default defineConfig({
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../out/renderer",
    emptyOutDir: true,
  },
  pack: [
    { ...shared, entry: { main: "src/main/main.ts" }, clean: true },
    // Eigener Durchlauf, damit der Preload eine einzige Datei ohne require() auf Nachbardateien bleibt.
    { ...shared, entry: { preload: "src/preload/preload.ts" }, clean: false },
  ],
});
