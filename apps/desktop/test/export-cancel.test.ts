import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebContents } from "electron";
import { ProjectStore } from "@feldspur/core";
import { applyImport, scanPaths } from "@feldspur/media";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { hasFfmpeg, makeSyncVideo } from "../../../packages/media/test/fixtures.ts";
import { IPC, type ExportProgress } from "../src/shared/api.ts";

const userData = mkdtempSync(join(tmpdir(), "feldspur-userdata-"));
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  ipcMain: { on: () => {}, handle: () => {} },
}));
const { cancelExport, exportRunning, runExport } = await import("../src/main/export.ts");

describe.skipIf(!hasFfmpeg())("Ausgabe abbrechen", () => {
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
    rmSync(dir, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  });

  it("meldet den Abbruch statt eines Fehlers und vergisst die alte Ausgabe im selben Ordner", async () => {
    const out = join(dir, "ausgabe");
    // Zuerst eine fertige Ausgabe ohne Video: Sie steht danach als letzter Stand in der Projektdatei.
    const quiet = { send: () => {} } as unknown as WebContents;
    const first = await runExport(store, quiet, sessionId, out, { video: false });
    expect("cancelled" in first).toBe(false);
    expect(store.getExportRecord(sessionId)).not.toBeNull();

    // Dann mit Video in denselben Ordner, abgebrochen, sobald das Video beginnt.
    const wc = {
      send: (channel: string, p: ExportProgress) => {
        if (channel === IPC.exportProgress && p.step === "Montagevideo") cancelExport(sessionId);
      },
    } as unknown as WebContents;
    const r = await runExport(store, wc, sessionId, out, { video: true });
    expect(r).toEqual({ cancelled: true });
    // Dort liegen womöglich halbe Dateien: Der alte Stand gilt nicht mehr, ein Video gibt es nicht.
    expect(store.getExportRecord(sessionId)).toBeNull();
    expect(readdirSync(join(out, readdirSync(out)[0]!)).some((f) => f.endsWith(".mp4"))).toBe(false);
    expect(exportRunning()).toBe(false);
  });
});
