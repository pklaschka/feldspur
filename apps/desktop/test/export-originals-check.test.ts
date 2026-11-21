/**
 * Issue #116: Die Prüfung der Originale ist der erste Schritt der Ausgabe, nach der Ordnerwahl. Findet sie etwas,
 * hält die Ausgabe an, bevor etwas geschrieben ist, und gibt den gewählten Ordner mit zurück.
 */
import { existsSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { applyImport, scanPaths } from "@feldspur/media";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { hasFfmpeg, makeSyncVideo } from "../../../packages/media/test/fixtures.ts";
import { EXPORT_CHECK_STEP, IPC, type ExportProgress } from "../src/shared/api.ts";
import { fakeWebContents } from "./fake-webcontents.ts";
import { fakePowerSaveBlocker } from "./power-blocker.ts";

const userData = mkdtempSync(join(tmpdir(), "feldspur-userdata-"));
const power = vi.hoisted(() => ({ blocker: null as unknown as ReturnType<typeof fakePowerSaveBlocker> }));
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  ipcMain: { on: () => {}, handle: () => {} },
  powerSaveBlocker: (power.blocker = fakePowerSaveBlocker()),
}));
const { cancelExport, exportRunning, exportStatus, runExport } = await import("../src/main/export.ts");

describe.skipIf(!hasFfmpeg())("Ausgabe: Originale prüfen als erster Schritt", () => {
  let dir: string;
  let video: string;
  let store: ProjectStore;
  let sessionId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-pruefen-"));
    const raw = join(dir, "roh");
    mkdirSync(raw);
    video = join(raw, "C0001.MP4");
    makeSyncVideo(video, { seconds: 4, creationTime: "2026-09-14T08:18:47.000000Z" });
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14", extra: {} }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const recorder = () => {
    const steps: ExportProgress[] = [];
    const wc = fakeWebContents((channel: string, p: ExportProgress) => channel === IPC.exportProgress && steps.push(p));
    return { steps, wc };
  };

  it("prüft zuerst die Originale (Fortschritt in Bytes) und gibt dann aus", async () => {
    const { steps, wc } = recorder();
    // Wenn: ausgegeben wird
    const r = await runExport(store, wc, sessionId, join(dir, "ok"), { video: false });
    expect("files" in r).toBe(true);
    // Dann: ist die Prüfung der erste Schritt und zählt die Bytes der Datei
    expect(steps[0]?.step).toBe(EXPORT_CHECK_STEP);
    const checks = steps.filter((p) => p.step === EXPORT_CHECK_STEP);
    expect(checks.at(-1)).toMatchObject({ done: checks.at(-1)!.total });
    expect(checks.at(-1)!.total).toBe(store.listSources(sessionId)[0]!.sizeBytes);
    // Dann: kommen alle Prüfschritte vor dem ersten Schritt, der schreibt
    const firstOther = steps.findIndex((p) => p.step !== EXPORT_CHECK_STEP);
    expect(steps.slice(firstOther).some((p) => p.step === EXPORT_CHECK_STEP)).toBe(false);
  });

  it("hält bei einem veränderten Original an, ohne zu schreiben, und nennt den gewählten Ordner", async () => {
    // Angenommen: das Video hat dieselbe Größe, aber anderen Inhalt (das findet nur die Prüfsumme)
    const fd = openSync(video, "r+");
    writeSync(fd, Buffer.from("FELDSPUR"), 0, 8, 2000);
    closeSync(fd);
    // Wenn: ausgegeben wird, dann hält die Ausgabe an, ohne den Ordner anzulegen, und nennt ihn
    const parent = join(dir, "veraendert");
    const r = await runExport(store, recorder().wc, sessionId, parent, { video: false });
    expect(r).toMatchObject({ parent, originals: { blocking: [], warnings: [expect.any(String)] } });
    expect(existsSync(parent)).toBe(false);
    expect(exportRunning()).toBe(false);

    // Wenn: „Trotzdem ausgeben“ gewählt wird, dann folgt nach derselben Prüfung die Ausgabe
    const again = await runExport(store, recorder().wc, sessionId, parent, { video: false, acceptOriginals: true });
    expect("files" in again).toBe(true);
    // Dann: gilt die Ausgabe als aktuell (die Prüfung ändert am Stand nichts)
    expect(exportStatus(store, sessionId, { video: false })?.differences).toEqual([]);
  });

  it("hält bei fehlender Pflichtdatei auch mit acceptOriginals an", async () => {
    // Angenommen: das Video ist verschwunden
    const away = `${video}.weg`;
    renameSync(video, away);
    try {
      // Wenn: trotzdem ausgegeben werden soll, dann hält die Ausgabe an, ohne zu schreiben
      const r = await runExport(store, recorder().wc, sessionId, join(dir, "fehlt"), {
        video: true,
        acceptOriginals: true,
      });
      expect(r).toMatchObject({ originals: { blocking: [expect.any(String)] } });
      expect(existsSync(join(dir, "fehlt"))).toBe(false);
    } finally {
      renameSync(away, video);
    }
  });

  it("lässt sich schon während der Prüfung abbrechen", async () => {
    // Angenommen: die Datei ist neu gestempelt, damit die Prüfsumme nicht aus dem Zwischenspeicher kommt
    const fd = openSync(video, "r+");
    writeSync(fd, Buffer.from("feldspur"), 0, 8, 2000);
    closeSync(fd);
    // Wenn: während der Prüfung abgebrochen wird
    const wc = fakeWebContents((channel: string, p: ExportProgress) => {
      if (channel === IPC.exportProgress && p.step === EXPORT_CHECK_STEP) cancelExport(sessionId);
    });
    const r = await runExport(store, wc, sessionId, join(dir, "abbruch"), { video: false });
    // Dann: meldet die App den Abbruch und hat nichts geschrieben
    expect(r).toEqual({ cancelled: true });
    expect(existsSync(join(dir, "abbruch"))).toBe(false);
    expect(exportRunning()).toBe(false);
  });
});
