/**
 * Vorabprüfung des Ausgabeordners und verständliche Fehlertexte beim Schreiben
 * (`packages/media/src/write-check.ts`).
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { ensureWritable, friendlyWriteError, friendlyWriteErrorIn, writeErrorText } from "../src/write-check.ts";

const errno = (code: string, path?: string) =>
  Object.assign(new Error(`${code}: irgendwas, open '${path}'`), { code, path });

const gesperrt =
  "ist noch in einem anderen Programm geöffnet (z. B. Word, Excel oder MAXQDA). Bitte dort schließen und erneut ausgeben.";

describe("writeErrorText", () => {
  it.each`
    code        | pfad               | ordner       | text
    ${"EBUSY"}  | ${"/x/Tag.docx"}   | ${undefined} | ${`„Tag.docx“ ${gesperrt}`}
    ${"EPERM"}  | ${"C:/x/Tag.docx"} | ${undefined} | ${`„Tag.docx“ ${gesperrt}`}
    ${"ENOSPC"} | ${"/x/a.mp4"}      | ${undefined} | ${"Der Datenträger ist voll."}
    ${"EACCES"} | ${"/x/a.mp4"}      | ${undefined} | ${"Keine Schreibrechte im Ordner „/x“."}
    ${"EACCES"} | ${undefined}       | ${"/ziel"}   | ${"Keine Schreibrechte im Ordner „/ziel“."}
  `("$code bei $pfad wird zu „$text“", ({ code, pfad, ordner, text }) => {
    expect(writeErrorText(errno(code, pfad), ordner)).toBe(text);
  });

  it("lässt andere Fehler unverändert", () => {
    expect(writeErrorText(errno("EIO", "/x"))).toContain("EIO");
    const other = new Error("ffmpeg kaputt");
    expect(friendlyWriteError(other)).toBe(other);
  });

  it("friendlyWriteError übersetzt die Meldung im Fehler selbst", () => {
    expect(friendlyWriteError(errno("EBUSY", "/x/a.docx"))).toMatchObject({
      message: expect.stringContaining("„a.docx“"),
    });
  });
});

describe("friendlyWriteErrorIn", () => {
  it.each`
    code        | pfad                                    | meldung
    ${"EBUSY"}  | ${"/ziel/Tag/a.docx"}                   | ${`„a.docx“ ${gesperrt}`}
    ${"EACCES"} | ${undefined}                            | ${"Keine Schreibrechte im Ordner „/ziel/Tag“."}
    ${"ENOSPC"} | ${"/tmp/x.mp4"}                         | ${"Der Datenträger ist voll."}
    ${"EBUSY"}  | ${"/tmp/feldspur-export-1/still-1.jpg"} | ${null}
    ${"EACCES"} | ${"/ziel/Tag2/a.docx"}                  | ${null}
  `("$code bei $pfad, Ausgabeordner /ziel/Tag: $meldung", ({ code, pfad, meldung }) => {
    const e = errno(code, pfad);
    const r = friendlyWriteErrorIn(e, "/ziel/Tag");
    // Fehler außerhalb des Ausgabeordners (meldung null) bleiben unverändert; ein voller Datenträger gilt überall.
    if (meldung === null) expect(r).toBe(e);
    else expect(r).toMatchObject({ message: meldung });
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
