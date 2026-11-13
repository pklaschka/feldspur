import tailwindcss from "@tailwindcss/vite";
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
  noExternal: [/^@feldspur\//, "better-sqlite3", "bindings", "file-uri-to-path"],
  // better-sqlite3 wird mit eingebündelt; die native Bibliothek kommt immer über nativeBinding.
  external: ["electron"],
};

export default defineConfig({
  root: "src/renderer",
  base: "./",
  // Tailwind bringt die Plugin-Typen des normalen Vite mit; zur Laufzeit passen sie zu Vite+.
  plugins: [tailwindcss() as unknown as NonNullable<UserConfig["plugins"]>[number]],
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
