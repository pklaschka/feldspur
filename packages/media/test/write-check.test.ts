import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { ensureWritable, friendlyWriteError, friendlyWriteErrorIn, writeErrorText } from "../src/write-check.ts";

const errno = (code: string, path?: string) =>
  Object.assign(new Error(`${code}: irgendwas, open '${path}'`), { code, path });

describe("writeErrorText", () => {
  it("übersetzt gesperrte Dateien", () => {
    const text =
      "ist noch in einem anderen Programm geöffnet (z. B. Word, Excel oder MAXQDA). Bitte dort schließen und erneut ausgeben.";
    expect(writeErrorText(errno("EBUSY", "/x/Tag.docx"))).toBe(`„Tag.docx“ ${text}`);
    expect(writeErrorText(errno("EPERM", "C:\\x\\Tag.docx".replace(/\\/g, "/")))).toBe(`„Tag.docx“ ${text}`);
  });
  it("übersetzt volle Datenträger und fehlende Schreibrechte", () => {
    expect(writeErrorText(errno("ENOSPC", "/x/a.mp4"))).toBe("Der Datenträger ist voll.");
    expect(writeErrorText(errno("EACCES", "/x/a.mp4"))).toBe("Keine Schreibrechte im Ordner „/x“.");
    expect(writeErrorText(errno("EACCES"), "/ziel")).toBe("Keine Schreibrechte im Ordner „/ziel“.");
  });
  it("lässt anderes unverändert", () => {
    expect(writeErrorText(errno("EIO", "/x"))).toContain("EIO");
    const other = new Error("ffmpeg kaputt");
    expect(friendlyWriteError(other)).toBe(other);
    expect(friendlyWriteError(errno("EBUSY", "/x/a.docx"))).toMatchObject({
      message: expect.stringContaining("„a.docx“"),
    });
  });
});

describe("friendlyWriteErrorIn", () => {
  it("übersetzt nur Fehler im Ausgabeordner", () => {
    expect(friendlyWriteErrorIn(errno("EBUSY", "/ziel/Tag/a.docx"), "/ziel/Tag")).toMatchObject({
      message: expect.stringContaining("„a.docx“"),
    });
    const elsewhere = errno("EBUSY", "/tmp/feldspur-export-1/still-1.jpg");
    expect(friendlyWriteErrorIn(elsewhere, "/ziel/Tag")).toBe(elsewhere);
    const sibling = errno("EACCES", "/ziel/Tag2/a.docx");
    expect(friendlyWriteErrorIn(sibling, "/ziel/Tag")).toBe(sibling);
    expect(friendlyWriteErrorIn(errno("EACCES"), "/ziel/Tag")).toMatchObject({
      message: "Keine Schreibrechte im Ordner „/ziel/Tag“.",
    });
    expect(friendlyWriteErrorIn(errno("ENOSPC", "/tmp/x.mp4"), "/ziel/Tag")).toMatchObject({
      message: "Der Datenträger ist voll.",
    });
  });
});

describe("ensureWritable", () => {
  const dir = mkdtempSync(join(tmpdir(), "feldspur-write-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("akzeptiert neue und beschreibbare Dateien", async () => {
    const f = join(dir, "da.docx");
    writeFileSync(f, "x");
    await expect(ensureWritable([f, join(dir, "neu.xlsx")])).resolves.toBeUndefined();
  });
  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "meldet eine schreibgeschützte Datei",
    async () => {
      const f = join(dir, "geschuetzt.docx");
      writeFileSync(f, "x");
      chmodSync(f, 0o444);
      await expect(ensureWritable([f])).rejects.toThrow(/Keine Schreibrechte im Ordner/);
    },
  );
});
