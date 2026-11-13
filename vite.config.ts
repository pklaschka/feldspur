import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 120,
    ignorePatterns: ["dist/**", "out/**"],
  },
  lint: {
    ignorePatterns: ["dist/**", "out/**"],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    testTimeout: 30_000,
    // Fixtures werden mit FFmpeg erzeugt und analysiert; auf Windows-Runnern dauert das länger als 10 s.
    hookTimeout: 60_000,
  },
});
