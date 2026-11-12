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
  },
});
