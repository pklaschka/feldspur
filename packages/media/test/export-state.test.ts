import { appendFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore, type ExportSettings } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { compareExport, exportFingerprint, FINGERPRINT_VERSION, settingsDifference } from "../src/export-state.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { hasFfmpeg, makePhoto } from "./fixtures.ts";

const SETTINGS: ExportSettings = { video: true, resolve: false, mixAudio: true, realtime: true, deviceTracks: true };

describe("Einstellungen im Vergleich", () => {
  it("nennt nur, was sich unterscheidet", () => {
    expect(settingsDifference(SETTINGS, SETTINGS)).toEqual([]);
    expect(settingsDifference(SETTINGS, { ...SETTINGS, video: false })).toEqual([
      "damals mit Montagevideo, jetzt ohne Montagevideo",
    ]);
  });

  it("liest eine ältere Ausgabe ohne Gerätespuren als „ohne“", () => {
    const { deviceTracks: _d, ...older } = SETTINGS;
    expect(settingsDifference(older as ExportSettings, SETTINGS)).toEqual([
      "damals ohne Tonspuren je Gerät, jetzt mit einer Tonspur je Gerät",
    ]);
    expect(settingsDifference(older as ExportSettings, { ...SETTINGS, deviceTracks: false })).toEqual([]);
  });
});

describe.skipIf(!hasFfmpeg())("Stand der Ausgabe über Neustarts", () => {
  let dir: string;
  let raw: string;
  let out: string;
  let path: string;
  let store: ProjectStore;
  let sessionId: string;

  /** So, wie die App nach einer Ausgabe speichert. */
  const record = (settings = SETTINGS) =>
    store.saveExportRecord({
      sessionId,
      exportedAt: new Date().toISOString(),
      dir: out,
      files: ["Feldtag.docx", "Feldtag_Begleitprotokoll.csv"],
      durationMs: 1000,
      options: settings,
      fingerprint: exportFingerprint(store, sessionId, settings),
    });
  const status = (settings = SETTINGS) => compareExport(store, store.getExportRecord(sessionId)!, settings);
  /** Projekt schließen und neu öffnen, wie bei einem Neustart der App. */
  const restart = () => {
    store.close();
    store = ProjectStore.open(path);
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-exportstand-"));
    raw = join(dir, "roh");
    out = join(dir, "aus");
    mkdirSync(raw);
    mkdirSync(out);
    makePhoto(join(raw, "IMG_20260914_101630.jpg"), "0x8a4fbf");
    makePhoto(join(raw, "IMG_20260914_102000.jpg"), "0x2f6b3a");
    for (const f of ["Feldtag.docx", "Feldtag_Begleitprotokoll.csv"]) writeFileSync(join(out, f), "x");
    path = join(dir, "Projekt.feldspur");
    store = ProjectStore.create(path, { name: "Test" });
    sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("unveränderte Daten und gleiche Einstellungen bleiben nach dem Neustart aktuell", () => {
    record();
    restart();
    expect(status()).toMatchObject({ differences: [], missingFiles: [] });
  });

  it("eine Änderung am Einsatz macht die Ausgabe auch nach dem Neustart veraltet", () => {
    record();
    restart();
    store.updateSession(sessionId, { place: "Marktplatz" });
    restart();
    expect(status().differences.map((d) => d.kind)).toEqual(["content"]);
  });

  it("rückgängig gemacht ist sie wieder aktuell", () => {
    record();
    store.history.record("Ort", () => store.updateSession(sessionId, { place: "Marktplatz" }));
    expect(status().differences).toHaveLength(1);
    store.history.undo();
    expect(status().differences).toEqual([]);
  });

  it("andere Einstellungen zählen als veraltet", () => {
    record();
    const st = status({ ...SETTINGS, video: false });
    expect(st.differences.map((d) => d.kind)).toEqual(["settings"]);
    expect(st.differences[0]!.text).toBe("Einstellung anders: damals mit Montagevideo, jetzt ohne Montagevideo.");
  });

  it("nennt veränderte und fehlende Originale mit Kurzzeichen", () => {
    record();
    const [a, b] = store.listSources(sessionId);
    appendFileSync(a!.originalPath, "verändert");
    unlinkSync(b!.originalPath);
    const st = status();
    expect(st.differences.find((d) => d.kind === "originals-changed")?.labels).toEqual([a!.label]);
    expect(st.differences.find((d) => d.kind === "originals-missing")?.labels).toEqual([b!.label]);
  });

  it("eine neue Quelle macht die Ausgabe veraltet", async () => {
    record();
    makePhoto(join(raw, "IMG_20260914_103000.jpg"), "0x112233");
    applyImport(store, sessionId, await scanPaths([join(raw, "IMG_20260914_103000.jpg")]));
    const kinds = status().differences.map((d) => d.kind);
    expect(kinds).toContain("content");
    expect(kinds).toContain("sources");
  });

  it("ein Abdruck aus einer älteren Fassung gilt nie als aktuell", () => {
    const r = record();
    store.saveExportRecord({ ...r, fingerprint: { ...r.fingerprint, version: FINGERPRINT_VERSION - 1 } });
    expect(status().differences.map((d) => d.kind)).toEqual(["version"]);
  });

  it("meldet Dateien, die im Ausgabeordner fehlen", () => {
    record();
    unlinkSync(join(out, "Feldtag.docx"));
    expect(status()).toMatchObject({ differences: [], missingFiles: ["Feldtag.docx"] });
  });
});
