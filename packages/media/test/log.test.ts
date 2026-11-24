/**
 * Arbeitsprotokoll (`packages/media/src/log.ts`, Issue #168): Ein- und Ausschalten, Form der Zeilen, und dass
 * Einsammeln und Ausgeben ihre Schritte vermerken.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { exportSession } from "../src/export.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { log, logCommand, logSize, setLogEnabled, setLogSink } from "../src/log.ts";
import { hasFfmpeg, makeFieldDay } from "./fixtures.ts";

/** Fängt das Protokoll ein, solange `fn` läuft. */
async function protocol(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const before = setLogSink((l) => lines.push(l));
  setLogEnabled(true);
  try {
    await fn();
  } finally {
    setLogEnabled(false);
    setLogSink(before);
  }
  return lines;
}

afterEach(() => setLogEnabled(false));

describe("Arbeitsprotokoll", () => {
  it("schweigt, solange es nicht eingeschaltet ist", () => {
    const lines: string[] = [];
    const before = setLogSink((l) => lines.push(l));
    log("ausgabe", "schreibt etwas");
    setLogSink(before);
    expect(lines).toEqual([]);
  });

  it("schreibt je Schritt eine Zeile mit Uhrzeit, Bereich und Text", async () => {
    const lines = await protocol(async () => log("ausgabe", "schreibt Einsatztranskript"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} ausgabe +schreibt Einsatztranskript$/);
  });

  it.each`
    bytes            | text
    ${512}           | ${"512 B"}
    ${48_000}        | ${"47 kB"}
    ${5_400_000}     | ${"5.1 MB"}
    ${3_000_000_000} | ${"2.79 GB"}
  `("$bytes Bytes stehen als $text da", ({ bytes, text }) => {
    expect(logSize(bytes)).toBe(text);
  });

  it("gibt ffmpeg-Aufrufe so wieder, dass man sie in der Konsole nachstellen kann", () => {
    expect(logCommand("ffmpeg", ["-i", "/Feld daten/Ton 1.m4a", "-f", "null", "-"])).toBe(
      "ffmpeg -i '/Feld daten/Ton 1.m4a' -f null -",
    );
  });
});

describe.skipIf(!hasFfmpeg())("Arbeitsprotokoll beim Einsammeln und Ausgeben", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  let einsammeln: string[];

  // Angenommen: ein kleiner Feldtag wird eingesammelt, das Protokoll läuft mit
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-protokoll-"));
    makeFieldDay(join(dir, "roh"));
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14" }).id;
    einsammeln = await protocol(async () => applyImport(store, sessionId, await scanPaths([join(dir, "roh")])));
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("nennt beim Einsammeln jede Datei mit Pfad, Art, Gerät und Zeitbelegen", () => {
    const text = einsammeln.join("\n");
    expect(text).toMatch(/liest .*ZOOM0004\.m4a/);
    expect(text).toMatch(/audio, Gerät „[^“]+“, SHA-256 [0-9a-f]{12}…, Zeit: metadata/);
    expect(text).toMatch(/ignoriert .*\.DS_Store \(System- oder Begleitdatei\)/);
    expect(text).toMatch(/legt Gerät „[^“]+“ an/);
    expect(text).toMatch(/übernimmt \S+ .*C0012\.MP4/);
  });

  it("nennt jeden ffprobe-Aufruf mit Befehlszeile und Ende", () => {
    const start = einsammeln.find((l) => / ffmpeg +#\d+ startet ffprobe .*ZOOM0004\.m4a/.test(l));
    expect(start).toBeDefined();
    const run = start!.match(/#(\d+)/)![1];
    expect(einsammeln.some((l) => l.includes(`#${run} fertig nach`))).toBe(true);
  });

  it("nennt beim Ausgeben jede geschriebene Datei mit Pfad und Größe", { timeout: 120_000 }, async () => {
    // Wenn: ohne Montagevideo ausgegeben wird
    const out = join(dir, "aus");
    const lines = await protocol(() => exportSession(store, sessionId, out, { video: false }));

    // Dann: stehen Beginn, jede Datei und das Ende im Protokoll
    const text = lines.join("\n");
    expect(text).toMatch(/ausgabe +beginnt \S+ nach .*aus \(Montagevideo nein/);
    for (const what of ["Einsatztranskript", "Dokumentvariablen", "Begleitprotokoll"])
      expect(text).toMatch(new RegExp(`schreibt ${what} .*aus.* \\(\\d+(\\.\\d)? (B|kB|MB)\\)`));
    expect(text).toMatch(/fertig nach .*\.docx/);
    expect(text).toContain("Arbeitsordner entfernt");
  });
});
