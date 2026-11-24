/**
 * Geschätzte Größe des Montagevideos im Schritt „Ausgeben“ (`apps/desktop/src/main/montage-size.ts`): Die Schätzung
 * lernt aus den letzten Ausgaben. Der zweite Teil braucht ffmpeg, sonst übersprungen.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { applyImport, scanPaths } from "@feldspur/media";
import { describe, expect, it, vi } from "vite-plus/test";
import { hasFfmpeg, makeSyncVideo } from "../../../packages/media/test/fixtures.ts";
import { fakePowerSaveBlocker } from "./power-blocker.ts";

const userData = mkdtempSync(join(tmpdir(), "feldspur-groesse-"));
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  ipcMain: { on: () => {}, handle: () => {} },
  powerSaveBlocker: fakePowerSaveBlocker(),
}));
const { learnMontageSize, sizeFactor } = await import("../src/main/montage-size.ts");
const { previewExport } = await import("../src/main/export.ts");

describe("Größenschätzung lernt aus den letzten Ausgaben", () => {
  it("bleibt ohne Ausgabe bei der Schätzung", () => {
    expect(sizeFactor()).toBe(1);
  });

  it("nimmt das geometrische Mittel, damit halb so groß und doppelt so groß sich aufheben", () => {
    expect(sizeFactor([0.5, 2])).toBeCloseTo(1);
    expect(sizeFactor([1.7, 1.7])).toBeCloseTo(1.7);
  });

  it("liest die gemerkten Faktoren aus dem Benutzerordner und übergeht Unsinn", () => {
    // Angenommen: zwei Ausgaben, eine 1,7-mal, eine 1,8-mal so groß wie geschätzt, dazu ein kaputter Eintrag
    writeFileSync(join(userData, "groessenschaetzung.json"), JSON.stringify({ ratios: [1.7, "x", 1.8, -1] }));
    expect(sizeFactor()).toBeCloseTo(Math.sqrt(1.7 * 1.8));
  });
});

describe.skipIf(!hasFfmpeg())("Größenschätzung nach einer Ausgabe", () => {
  it("merkt sich, wie weit die Schätzung danebenlag, und trifft danach die echte Größe", async () => {
    // Angenommen: ein Einsatz mit einem kurzen Video, noch keine gemerkten Faktoren
    const dir = mkdtempSync(join(tmpdir(), "feldspur-groesse-ausgabe-"));
    rmSync(join(userData, "groessenschaetzung.json"), { force: true });
    const raw = join(dir, "roh");
    mkdirSync(raw);
    makeSyncVideo(join(raw, "C0001.MP4"), { seconds: 8, creationTime: "2026-09-14T08:18:47.000000Z" });
    const store = ProjectStore.open(":memory:");
    const sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14", extra: {} }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
    const before = previewExport(store, sessionId).videoBytes.video;
    // Wenn: das ausgegebene Video 1,7-mal so groß ist wie geschätzt
    const mp4 = join(dir, "Montage.mp4");
    writeFileSync(mp4, Buffer.alloc(Math.round(before * 1.7)));
    learnMontageSize(store, sessionId, { mode: "realtime", episodes: false }, mp4, true);
    // Dann: ein Faktor ist gemerkt, und die nächste Schätzung trifft die echte Größe
    expect(JSON.parse(readFileSync(join(userData, "groessenschaetzung.json"), "utf8")).ratios).toHaveLength(1);
    expect(previewExport(store, sessionId).videoBytes.video / statSync(mp4).size).toBeCloseTo(1, 3);
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
});
