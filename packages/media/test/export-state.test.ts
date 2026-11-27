/**
 * Stand einer Ausgabe über Neustarts hinweg (`packages/media/src/export-state.ts`, Issue #72): Wann gilt eine Ausgabe
 * als veraltet, und mit welcher Begründung?
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore, type ExportSettings } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { compareExport, exportFingerprint, FINGERPRINT_VERSION, settingsDifference } from "../src/export-state.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { hasFfmpeg, makePhoto } from "./fixtures.ts";

const SETTINGS: ExportSettings = {
  video: true,
  resolve: false,
  mixAudio: true,
  realtime: true,
  deviceTracks: true,
  viewer: true,
  readme: true,
  changeLog: true,
  manifest: true,
  roCrate: false,
  originals: false,
  videoHeight: 720,
  videoFps: 25,
};

describe("Einstellungen im Vergleich", () => {
  it("nennt nur, was sich unterscheidet", () => {
    // Gleiche Einstellungen: kein Unterschied; nur ohne Video: genau dieser
    expect(settingsDifference(SETTINGS, SETTINGS)).toEqual([]);
    expect(settingsDifference(SETTINGS, { ...SETTINGS, video: false })).toEqual([
      "damals mit Montagevideo, jetzt ohne Montagevideo",
    ]);
  });

  it("liest eine ältere Ausgabe ohne Gerätespuren als „ohne“", () => {
    // Angenommen: eine ältere Ausgabe kannte die Einstellung „Gerätespuren“ noch nicht
    const { deviceTracks: _d, ...older } = SETTINGS;
    // Dann: gilt sie als „ohne“, im Vergleich mit „mit“ und mit „ohne“
    expect(settingsDifference(older as ExportSettings, SETTINGS)).toEqual([
      "damals ohne Tonspuren je Gerät, jetzt mit einer Tonspur je Gerät",
    ]);
    expect(settingsDifference(older as ExportSettings, { ...SETTINGS, deviceTracks: false })).toEqual([]);
  });

  it("nennt eine andere Auflösung oder Bildrate des Videos mit beiden Formaten", () => {
    expect(settingsDifference(SETTINGS, { ...SETTINGS, videoHeight: 360, videoFps: 10 })).toEqual([
      "damals 1280 × 720, 25 Bilder/s, jetzt 640 × 360, 10 Bilder/s",
    ]);
  });

  it("liest eine Ausgabe von vor der Wahl des Formats als 1280 × 720 bei 25 Bildern/s", () => {
    const { videoHeight: _h, videoFps: _f, ...older } = SETTINGS;
    expect(settingsDifference(older as ExportSettings, SETTINGS)).toEqual([]);
    expect(settingsDifference(older as ExportSettings, { ...SETTINGS, videoFps: 30 })).toEqual([
      "damals 1280 × 720, 25 Bilder/s, jetzt 1280 × 720, 30 Bilder/s",
    ]);
  });

  it("vergleicht das Format nur, wenn damals und jetzt ein Video dabei ist", () => {
    const without = { ...SETTINGS, video: false };
    expect(settingsDifference(without, { ...without, videoHeight: 1080 })).toEqual([]);
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
    // Angenommen: eine Ausgabe ist gespeichert
    record();
    // Wenn: die App neu startet
    restart();
    // Dann: ist die Ausgabe aktuell, keine Datei fehlt
    expect(status()).toMatchObject({ differences: [], missingFiles: [] });
  });

  it("eine Änderung am Einsatz macht die Ausgabe auch nach dem Neustart veraltet", () => {
    // Angenommen: eine Ausgabe ist gespeichert, die App neu gestartet
    record();
    restart();
    // Wenn: der Ort geändert und wieder neu gestartet wird
    store.updateSession(sessionId, { place: "Marktplatz" });
    restart();
    // Dann: ist die Ausgabe veraltet (Inhalt)
    expect(status().differences.map((d) => d.kind)).toEqual(["content"]);
  });

  it("rückgängig gemacht ist sie wieder aktuell", () => {
    // Angenommen: eine Ausgabe ist gespeichert
    record();
    // Wenn: der Ort geändert wird, dann ist sie veraltet
    store.history.record("Ort", () => store.updateSession(sessionId, { place: "Marktplatz" }));
    expect(status().differences).toHaveLength(1);
    // Wenn: das rückgängig gemacht wird, dann ist sie wieder aktuell
    store.history.undo();
    expect(status().differences).toEqual([]);
  });

  it("andere Einstellungen zählen als veraltet", () => {
    // Angenommen: eine Ausgabe mit Montagevideo
    record();
    // Wenn: jetzt ohne Montagevideo ausgegeben werden soll
    const st = status({ ...SETTINGS, video: false });
    // Dann: ist sie veraltet und der Unterschied wird genannt
    expect(st.differences.map((d) => d.kind)).toEqual(["settings"]);
    expect(st.differences[0]!.text).toBe("Einstellung anders: damals mit Montagevideo, jetzt ohne Montagevideo.");
  });

  it("nennt veränderte und fehlende Originale mit Kurzzeichen", () => {
    // Angenommen: eine Ausgabe ist gespeichert
    record();
    // Wenn: ein Original verändert und eines gelöscht wird
    const [a, b] = store.listSources(sessionId);
    appendFileSync(a!.originalPath, "verändert");
    unlinkSync(b!.originalPath);
    const st = status();
    // Dann: werden beide mit Kurzzeichen genannt
    expect(st.differences.find((d) => d.kind === "originals-changed")?.labels).toEqual([a!.label]);
    expect(st.differences.find((d) => d.kind === "originals-missing")?.labels).toEqual([b!.label]);
  });

  it("eine neue Quelle macht die Ausgabe veraltet", async () => {
    // Angenommen: eine Ausgabe ist gespeichert
    record();
    // Wenn: ein weiteres Foto eingesammelt wird
    makePhoto(join(raw, "IMG_20260914_103000.jpg"), "0x112233");
    applyImport(store, sessionId, await scanPaths([join(raw, "IMG_20260914_103000.jpg")]));
    const kinds = status().differences.map((d) => d.kind);
    // Dann: ist sie veraltet (Inhalt und Quellen)
    expect(kinds).toContain("content");
    expect(kinds).toContain("sources");
  });

  it("ein Abdruck aus einer älteren Fassung gilt nie als aktuell", () => {
    // Angenommen: eine Ausgabe mit dem Abdruck einer älteren Feldspur-Fassung
    const r = record();
    store.saveExportRecord({ ...r, fingerprint: { ...r.fingerprint, version: FINGERPRINT_VERSION - 1 } });
    // Dann: gilt sie als veraltet (Fassung)
    expect(status().differences.map((d) => d.kind)).toEqual(["version"]);
  });

  it("meldet Dateien, die im Ausgabeordner fehlen", () => {
    // Angenommen: eine Ausgabe ist gespeichert
    record();
    // Wenn: die .docx im Ausgabeordner gelöscht wird
    unlinkSync(join(out, "Feldtag.docx"));
    // Dann: wird sie als fehlend gemeldet, der Inhalt bleibt aktuell
    expect(status()).toMatchObject({ differences: [], missingFiles: ["Feldtag.docx"] });
  });
});
