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
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    testTimeout: 30_000,
    // Fixtures werden mit FFmpeg erzeugt und analysiert; auf Windows-Runnern dauert das länger als 10 s.
    hookTimeout: 60_000,
  },
});
