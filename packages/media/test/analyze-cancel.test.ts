/**
 * Abbrechen der Tonspur-Analyse und der Pegelmessung (`packages/media/src/analyze.ts`, Issue #135), an einem mit FFmpeg
 * erzeugten Feldtag. Läuft nur, wenn ffmpeg vorhanden ist.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { analyzeSession, sessionLevels } from "../src/analyze.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { hasFfmpeg, makeSyncDay } from "./fixtures.ts";

// Issue #135: Tonspur-Analyse und Pegelmessung lassen sich abbrechen.
describe.skipIf(!hasFfmpeg())("Abbrechen bei Analyse und Pegelmessung", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;

  // Angenommen: ein Einsatz mit dem erfundenen Markttag, noch nicht analysiert
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-abbruch-"));
    makeSyncDay(dir);
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Abbruch", date: "2026-09-14" }).id;
    applyImport(store, sessionId, await scanPaths([dir]));
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("die Pegelmessung meldet einen Abbruch als Abbruch, nicht als unbekannten Pegel", async () => {
    // Wenn: die Messung abgebrochen wird, sobald sie begonnen hat
    const ctrl = new AbortController();
    const run = sessionLevels(store, sessionId, {
      measureMissing: true,
      signal: ctrl.signal,
      onProgress: (done, total) => {
        if (done === 0 && total > 0) queueMicrotask(() => ctrl.abort());
      },
    });
    // Dann: endet sie mit einem Abbruch
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });

  it("die Tonspur-Analyse bricht mitten in einer Datei ab, ohne sie als nicht lesbar zu melden", async () => {
    // Wenn: die Analyse abgebrochen wird, sobald die erste Datei läuft
    const ctrl = new AbortController();
    const run = analyzeSession(store, sessionId, {
      signal: ctrl.signal,
      // Abbrechen, sobald die erste Datei läuft.
      onProgress: (done, total) => {
        if (done === 0 && total > 0) queueMicrotask(() => ctrl.abort());
      },
    });
    // Dann: endet sie mit einem Abbruch und hinterlässt keine Vorschläge
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(store.listAnchors(sessionId).filter((a) => a.proposed)).toEqual([]);
  });

  it("danach läuft die Analyse vollständig durch", async () => {
    const r = await analyzeSession(store, sessionId);
    expect(r.failed).toEqual([]);
  });
});
