import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { applyImport, compareExport, methodsSummary, scanPaths } from "@feldspur/media";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { hasFfmpeg, makeSyncVideo } from "../../../packages/media/test/fixtures.ts";
import { fakeWebContents } from "./fake-webcontents.ts";
import { fakePowerSaveBlocker } from "./power-blocker.ts";
import { IPC, type ExportChoices, type ExportProgress } from "../src/shared/api.ts";

const userData = mkdtempSync(join(tmpdir(), "feldspur-userdata-"));
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  ipcMain: { on: () => {}, handle: () => {} },
  powerSaveBlocker: fakePowerSaveBlocker(),
}));
const { cancelExport, exportSettings, runExport } = await import("../src/main/export.ts");

/** Prüft die Prüfsummenliste wie `sha256sum -c`: Name → stimmt die Prüfsumme? */
function checkManifest(dir: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const line of readFileSync(join(dir, "manifest-sha256.txt"), "utf8").trim().split("\n")) {
    const [sum, name] = line.split("  ");
    out[name!] =
      createHash("sha256")
        .update(readFileSync(join(dir, name!)))
        .digest("hex") === sum;
  }
  return out;
}

describe.skipIf(!hasFfmpeg())("Erneut ausgeben", () => {
  let dir: string;
  let raw: string;
  let store: ProjectStore;
  const wc = fakeWebContents();
  const ALL: ExportChoices = { video: false, readme: true, changeLog: true, manifest: true };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-erneut-"));
    raw = join(dir, "roh");
    mkdirSync(raw);
    makeSyncVideo(join(raw, "C0001.MP4"), { seconds: 4, creationTime: "2026-09-14T08:18:47.000000Z" });
    store = ProjectStore.open(":memory:");
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const session = async (title: string, date = "2026-09-14") => {
    const id = store.addSession({ title, date, extra: {} }).id;
    applyImport(store, id, await scanPaths([raw]));
    return id;
  };
  const exportTo = async (id: string, out: string, opts: ExportChoices) => {
    const r = await runExport(store, wc, id, out, opts);
    if (!("dir" in r)) throw new Error(`keine Ausgabe: ${JSON.stringify(r)}`);
    return r;
  };

  it.each`
    abgewaehlt                             | weg
    ${{ manifest: false }}                 | ${["manifest-sha256.txt"]}
    ${{ readme: false, changeLog: false }} | ${["LIESMICH.html", "Feldtag_2026-09-14_Weniger_Aenderungsprotokoll.csv"]}
  `("räumt Dateien der letzten Ausgabe weg, die diesmal nicht entstehen: $weg (#227)", async ({ abgewaehlt, weg }) => {
    // Angenommen: ein Einsatz, mit allen Nachweisen ausgegeben, und eine fremde Datei im selben Ordner
    const id = await session("Weniger");
    const out = join(dir, `weniger-${weg.length}`);
    const first = await exportTo(id, out, ALL);
    for (const f of weg) expect(first.files.map((p) => basename(p))).toContain(f);
    writeFileSync(join(first.dir, "eigene-notiz.txt"), "bleibt");
    // Wenn: ohne diese Teile erneut in denselben Ordner ausgegeben wird
    const again = await exportTo(id, out, { ...ALL, ...abgewaehlt });
    // Dann: liegen genau die neuen Dateien im Ordner, dazu die fremde Datei
    expect(again.dir).toBe(first.dir);
    expect(readdirSync(again.dir).sort()).toEqual([...again.files.map((p) => basename(p)), "eigene-notiz.txt"].sort());
    for (const f of weg) expect(readdirSync(again.dir)).not.toContain(f);
    // Und: die Prüfsummenliste (wo es eine gibt) stimmt für jede Datei
    if (again.files.some((p) => p.endsWith("manifest-sha256.txt")))
      expect(Object.values(checkManifest(again.dir)).every(Boolean)).toBe(true);
  });

  it("räumt auch nach einer abgebrochenen Ausgabe auf (#227)", async () => {
    // Angenommen: eine Ausgabe mit allen Nachweisen, die nächste in denselben Ordner wird beim Video abgebrochen
    const id = await session("Abbruch");
    const out = join(dir, "abbruch");
    const first = await exportTo(id, out, ALL);
    const stop = fakeWebContents((channel: string, p: ExportProgress) => {
      if (channel === IPC.exportProgress && p.step === "Montagevideo") cancelExport(id);
    });
    expect(await runExport(store, stop, id, out, { ...ALL, video: true })).toEqual({ cancelled: true });
    expect(store.getExportRecord(id)).toBeNull();
    // Wenn: danach ohne LIESMICH und Prüfsummenliste ausgegeben wird
    const again = await exportTo(id, out, { ...ALL, readme: false, manifest: false });
    // Dann: liegen LIESMICH und Prüfsummenliste der ersten Ausgabe nicht mehr im Ordner
    expect(again.dir).toBe(first.dir);
    expect(readdirSync(again.dir).sort()).toEqual(again.files.map((p) => basename(p)).sort());
  });

  it("gibt zwei Einsätze mit gleichem Datum und Titel in getrennte Ordner aus (#230)", async () => {
    // Angenommen: zwei Einsätze „Doppelt“ am selben Tag; der zweite schreibt „Doppelt?“, was im Dateinamen gleich wird
    const one = await session("Doppelt", "2026-09-20");
    const two = await session("Doppelt?", "2026-09-20");
    const out = join(dir, "doppelt");
    // Wenn: beide in denselben Ordner ausgegeben werden
    const a = await exportTo(one, out, ALL);
    const b = await exportTo(two, out, ALL);
    // Dann: liegt jeder in seinem eigenen Ordner, und keiner hat die Dateien des anderen überschrieben
    expect(basename(a.dir)).toBe("Feldtag_2026-09-20_Doppelt");
    expect(basename(b.dir)).toBe("Feldtag_2026-09-20_Doppelt (2)");
    expect(Object.values(checkManifest(a.dir)).every(Boolean)).toBe(true);
    // Und: beide Ausgaben stehen zu Recht auf „aktuell“
    for (const id of [one, two]) {
      const record = store.getExportRecord(id)!;
      const status = compareExport(store, record, exportSettings(store, id, ALL));
      expect({ differences: status.differences, missing: status.missingFiles }).toEqual({
        differences: [],
        missing: [],
      });
      expect(methodsSummary(store, id, record.options).exported).toBe("current");
    }
    // Wenn: der zweite erneut ausgegeben wird, dann bleibt er in seinem Ordner
    expect((await exportTo(two, out, ALL)).dir).toBe(b.dir);
    // Wenn: der erste in einen anderen Ordner zieht, dann bleibt der zweite trotzdem in seinem
    await exportTo(one, join(dir, "anderswo"), ALL);
    expect((await exportTo(two, out, ALL)).dir).toBe(b.dir);
  });
});
