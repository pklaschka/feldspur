import { describe, expect, it, vi } from "vite-plus/test";

// Gesperrte Datei (Windows: Word hat sie offen) per Mock nachgestellt, damit der Test auch als root läuft.
vi.mock("node:fs/promises", async (orig) => ({
  ...(await orig<typeof import("node:fs/promises")>()),
  open: vi.fn(async (path: string) => {
    throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${path}'`), { code: "EBUSY", path });
  }),
}));

describe("ensureWritable bei gesperrter Datei", () => {
  it("meldet sie mit verständlichem Text", async () => {
    const { ensureWritable } = await import("../src/write-check.ts");
    await expect(ensureWritable(["/ziel/Tag.docx"])).rejects.toThrow(
      "„Tag.docx“ ist noch in einem anderen Programm geöffnet (z. B. Word, Excel oder MAXQDA). Bitte dort schließen und erneut ausgeben.",
    );
  });
});
