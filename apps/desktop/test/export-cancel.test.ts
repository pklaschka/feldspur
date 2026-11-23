import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { applyImport, scanPaths } from "@feldspur/media";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { hasFfmpeg, makeSyncVideo } from "../../../packages/media/test/fixtures.ts";
import { fakeWebContents } from "./fake-webcontents.ts";
import { fakePowerSaveBlocker } from "./power-blocker.ts";
import { IPC, type ExportProgress } from "../src/shared/api.ts";

const userData = mkdtempSync(join(tmpdir(), "feldspur-userdata-"));
const power = vi.hoisted(() => ({ blocker: null as unknown as ReturnType<typeof fakePowerSaveBlocker> }));
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  ipcMain: { on: () => {}, handle: () => {} },
  powerSaveBlocker: (power.blocker = fakePowerSaveBlocker()),
}));
const { abortExport, cancelExport, exportRunning, runExport } = await import("../src/main/export.ts");

describe.skipIf(!hasFfmpeg())("Ausgabe in denselben Ordner: Abbruch und Fehler", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-cancel-"));
    const raw = join(dir, "roh");
    mkdirSync(raw);
    makeSyncVideo(join(raw, "C0001.MP4"), { seconds: 20, creationTime: "2026-09-14T08:18:47.000000Z" });
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14", extra: {} }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("meldet den Abbruch statt eines Fehlers und vergisst die alte Ausgabe im selben Ordner", async () => {
    const out = join(dir, "ausgabe");
    // Angenommen: eine fertige Ausgabe ohne Video, sie steht als letzter Stand in der Projektdatei
    const quiet = fakeWebContents();
    const first = await runExport(store, quiet, sessionId, out, { video: false });
    expect("cancelled" in first).toBe(false);
    expect(store.getExportRecord(sessionId)).not.toBeNull();

    // Wenn: mit Video in denselben Ordner ausgegeben und beim Video abgebrochen wird
    const wc = fakeWebContents((channel: string, p: ExportProgress) => {
      if (channel === IPC.exportProgress && p.step === "Montagevideo") cancelExport(sessionId);
    });
    const r = await runExport(store, wc, sessionId, out, { video: true });
    expect(r).toEqual({ cancelled: true });
    // Dann: gilt der alte Stand nicht mehr (dort liegen womöglich halbe Dateien), ein Video gibt es nicht
    expect(store.getExportRecord(sessionId)).toBeNull();
    expect(readdirSync(join(out, readdirSync(out)[0]!)).some((f) => f.endsWith(".mp4"))).toBe(false);
    expect(exportRunning()).toBe(false);
  });

  it("vergisst die alte Ausgabe schon beim ersten Schreiben, damit ein Absturz keine halbe als aktuell hinterlässt", async () => {
    const out = join(dir, "absturz");
    // Angenommen: eine fertige Ausgabe in diesem Ordner
    await runExport(store, fakeWebContents(), sessionId, out, { video: false });
    expect(store.getExportRecord(sessionId)).not.toBeNull();

    // Wenn: erneut mit Video in denselben Ordner ausgegeben wird und die App beim Video geschlossen wird
    let duringVideo: unknown = "nicht erreicht";
    const wc = fakeWebContents((channel: string, p: ExportProgress) => {
      if (channel !== IPC.exportProgress || p.step !== "Montagevideo" || duringVideo !== "nicht erreicht") return;
      duringVideo = store.getExportRecord(sessionId);
      abortExport();
    });
    // Dann: war der alte Stand schon während des Videos vergessen, und das Schließen bricht die Ausgabe ab
    expect(await runExport(store, wc, sessionId, out, { video: true })).toEqual({ cancelled: true });
    expect(duringVideo).toBeNull();
    expect(exportRunning()).toBe(false);
  });

  it("hält den Rechner während der Ausgabe wach und gibt ihn danach frei (Issue #142)", async () => {
    const seen: { types: string[]; throttling: boolean }[] = [];
    const wc = fakeWebContents((channel: string) => {
      if (channel === IPC.exportProgress)
        seen.push({ types: [...power.blocker.active.values()], throttling: wc.getBackgroundThrottling() });
    });
    // Wenn: ausgegeben wird
    await runExport(store, wc, sessionId, join(dir, "wach"), { video: false });
    // Dann: bleibt der Rechner bei jedem Schritt wach und das Fenster ungebremst, danach ist beides frei
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => x.types.join() === "prevent-app-suspension" && !x.throttling)).toBe(true);
    expect(power.blocker.active.size).toBe(0);
    expect(wc.getBackgroundThrottling()).toBe(true);
  });

  it("gibt den Rechner auch nach einem Abbruch frei", async () => {
    const wc = fakeWebContents((channel: string, p: ExportProgress) => {
      if (channel === IPC.exportProgress && p.step === "Montagevideo") cancelExport(sessionId);
    });
    // Wenn: beim Video abgebrochen wird, dann ist der Rechner danach frei
    expect(await runExport(store, wc, sessionId, join(dir, "wach-abbruch"), { video: true })).toEqual({
      cancelled: true,
    });
    expect(power.blocker.active.size).toBe(0);
  });

  it("hängt nicht, wenn die Oberfläche während der Einblendungen neu lädt (Issue #137)", async () => {
    const out = join(dir, "neu-geladen");
    // Wenn: die Oberfläche die Anfrage nach Einblendungen bekommt, nie antwortet und stattdessen neu lädt
    const wc = fakeWebContents((channel: string) => {
      if (channel === IPC.overlayRequest)
        queueMicrotask(() => (wc as unknown as EventEmitter).emit("did-start-loading"));
    });
    // Dann: bricht die Ausgabe mit einer Meldung ab, statt zu hängen
    await expect(runExport(store, wc, sessionId, out, { video: true })).rejects.toThrow(/neu geladen oder beendet/);
    expect(exportRunning()).toBe(false);
    // Dann: ist die nächste Ausgabe wieder möglich
    const again = await runExport(store, fakeWebContents(), sessionId, out, { video: false });
    expect("dir" in again).toBe(true);
  });

  it("behält den Stand der alten Ausgabe, wenn schon die Vorabprüfung scheitert", async () => {
    const out = join(dir, "vorab");
    // Angenommen: eine fertige Ausgabe
    const quiet = fakeWebContents();
    await runExport(store, quiet, sessionId, out, { video: false });
    const record = store.getExportRecord(sessionId);
    expect(record).not.toBeNull();

    // Wenn: die .docx nicht beschreibbar ist (wie in Word geöffnet; als Ordner, damit es auch als root scheitert)
    const docx = join(
      record!.dir,
      record!.files.find((f) => f.endsWith(".docx"))!,
    );
    rmSync(docx);
    mkdirSync(docx);
    await expect(runExport(store, quiet, sessionId, out, { video: false })).rejects.toThrow();
    // Dann: wurde nichts geschrieben, Stand und „Erneut ausgeben“ samt Ordner bleiben
    expect(store.getExportRecord(sessionId)).toEqual(record);
    expect(
      existsSync(
        join(
          record!.dir,
          record!.files.find((f) => f.endsWith(".xlsx"))!,
        ),
      ),
    ).toBe(true);
    expect(exportRunning()).toBe(false);
  });
});
