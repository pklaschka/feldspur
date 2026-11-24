/**
 * Einstellungen von Vite+ für das ganze Monorepo: Formatieren (`vp fmt`), Linten (`vp lint`) und Tests (`vp test`).
 * Wie die App gebaut wird, steht getrennt in `apps/desktop/vite.config.ts`.
 */
import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 120,
    ignorePatterns: ["dist/**", "out/**", ".agents/**"],
  },
  lint: {
    ignorePatterns: ["dist/**", "out/**", ".agents/**"],
    // Standard-Plugins plus React: Hook-Regeln prüfen, ob Effekte alle Werte kennen, die sie lesen.
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react"],
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
    overrides: [
      {
        // Kindprozesse nur über runTool (packages/media/src/process.ts): einheitlicher Abbruch, Zeitlimit, Fehlertext.
        files: ["packages/*/src/**", "apps/*/src/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [
                { name: "node:child_process", message: "ffmpeg/ffprobe über runTool aus process.ts starten." },
                { name: "child_process", message: "ffmpeg/ffprobe über runTool aus process.ts starten." },
              ],
            },
          ],
        },
      },
      { files: ["packages/media/src/process.ts"], rules: { "no-restricted-imports": "off" } },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    testTimeout: 30_000,
    // Fixtures werden mit FFmpeg erzeugt und analysiert; auf Windows-Runnern dauert das länger als 10 s.
    hookTimeout: 60_000,
  },
});
