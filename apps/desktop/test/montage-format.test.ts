/**
 * Auflösung und Bildrate des Montagevideos je Projekt (Issue #250, `apps/desktop/src/main/montage-format.ts`): stehen
 * in der Projektdatei, lassen sich rückgängig machen, gelten für Ausgabe, Ausgabestand und Größenschätzung.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { applyImport, scanPaths } from "@feldspur/media";
import { describe, expect, it, vi } from "vite-plus/test";
import { hasFfmpeg, makeSyncVideo } from "../../../packages/media/test/fixtures.ts";
import { fakePowerSaveBlocker } from "./power-blocker.ts";

const userData = mkdtempSync(join(tmpdir(), "feldspur-format-"));
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  ipcMain: { on: () => {}, handle: () => {} },
  powerSaveBlocker: fakePowerSaveBlocker(),
}));
const { projectFormat, setProjectFormat } = await import("../src/main/montage-format.ts");
const { exportSettings, previewExport } = await import("../src/main/export.ts");
const { buildSessionView } = await import("../src/main/view.ts");

describe("Format des Montagevideos je Projekt", () => {
  it("ohne Wahl 1280 × 720 bei 25 Bildern/s, wie bisher", () => {
    const store = ProjectStore.open(":memory:");
    expect(projectFormat(store)).toEqual({ height: 720, fps: 25 });
    store.close();
  });

  it("bleibt in der Projektdatei und gilt nach dem Öffnen wieder", () => {
    // Angenommen: ein Projekt auf der Platte, in dem 640 × 360 bei 10 Bildern/s gewählt ist
    const dir = mkdtempSync(join(tmpdir(), "feldspur-format-projekt-"));
    const path = join(dir, "Projekt.feldspur");
    const store = ProjectStore.create(path, { name: "Projekt" });
    setProjectFormat(store, { height: 360, fps: 10 });
    store.close();
    // Wenn: es neu geöffnet wird, dann gilt die Wahl noch
    const again = ProjectStore.open(path);
    expect(projectFormat(again)).toEqual({ height: 360, fps: 10 });
    again.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("lässt sich rückgängig machen und wiederholen", () => {
    const store = ProjectStore.open(":memory:");
    // Wenn: das Format als Schritt geändert wird (so wie der IPC-Aufruf)
    store.history.record("Videoeinstellungen geändert", () => setProjectFormat(store, { height: 1080, fps: 30 }));
    expect(projectFormat(store)).toEqual({ height: 1080, fps: 30 });
    // Wenn: rückgängig, dann wieder der Standard; wiederholen, dann wieder die Wahl
    expect(store.history.undo()).toBe("Videoeinstellungen geändert");
    expect(projectFormat(store)).toEqual({ height: 720, fps: 25 });
    store.history.redo();
    expect(projectFormat(store)).toEqual({ height: 1080, fps: 30 });
    store.close();
  });

  it("übernimmt Ungültiges nicht", () => {
    const store = ProjectStore.open(":memory:");
    setProjectFormat(store, { height: 480, fps: 60 });
    expect(projectFormat(store)).toEqual({ height: 720, fps: 25 });
    store.setMeta("montage_format", "kein JSON");
    expect(projectFormat(store)).toEqual({ height: 720, fps: 25 });
    store.close();
  });

  it("Ansicht und Einstellungen der Ausgabe folgen dem Projekt, eine ausdrückliche Angabe geht vor", () => {
    // Angenommen: ein Einsatz in einem Projekt mit 960 × 540 bei 15 Bildern/s
    const store = ProjectStore.open(":memory:");
    const sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14", extra: {} }).id;
    setProjectFormat(store, { height: 540, fps: 15 });
    // Dann: die Ansicht nennt es, die Einstellungen der Ausgabe übernehmen es
    expect(buildSessionView(store, sessionId).montageFormat).toEqual({ height: 540, fps: 15 });
    expect(exportSettings(store, sessionId, { video: true })).toMatchObject({ videoHeight: 540, videoFps: 15 });
    expect(exportSettings(store, sessionId, { video: true, videoHeight: 1080, videoFps: 30 })).toMatchObject({
      videoHeight: 1080,
      videoFps: 30,
    });
    store.close();
  });
});

describe.skipIf(!hasFfmpeg())("Größenschätzung im gewählten Format", () => {
  it("schätzt das Video in 640 × 360 kleiner als in 1280 × 720", async () => {
    // Angenommen: ein Einsatz mit einem kurzen Video
    const dir = mkdtempSync(join(tmpdir(), "feldspur-format-groesse-"));
    const raw = join(dir, "roh");
    mkdirSync(raw);
    makeSyncVideo(join(raw, "C0001.MP4"), { seconds: 8, creationTime: "2026-09-14T08:18:47.000000Z" });
    const store = ProjectStore.open(":memory:");
    const sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14", extra: {} }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
    const standard = previewExport(store, sessionId).videoBytes.video;
    // Wenn: das Projekt auf 640 × 360 bei 10 Bildern/s umgestellt wird, dann sinkt die Schätzung deutlich
    setProjectFormat(store, { height: 360, fps: 10 });
    expect(previewExport(store, sessionId).videoBytes.video).toBeLessThan(standard / 3);
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
});
