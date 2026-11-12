import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, ProjectStore, resolveTimeline } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { applyImport, scanPaths, type ImportCandidate } from "../src/import.ts";
import { hasFfmpeg, makeAudio, makeFieldDay } from "./fixtures.ts";

describe.skipIf(!hasFfmpeg())("Einsammeln eines Feldtags", () => {
  let dir: string;
  let plan: ImportCandidate[];
  const byName = (n: string) => plan.find((c) => c.fileName === n)!;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-import-"));
    makeFieldDay(dir);
    plan = await scanPaths([dir]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("findet alle Quellen, überspringt Begleitdateien", () => {
    expect(plan.map((c) => c.fileName).sort()).toEqual([
      "C0012.MP4",
      "C0013.MP4",
      "IMG_0231.jpg",
      "IMG_20260914_104050.jpg",
      "Tagebuch_S01.jpg",
      "ZOOM0004.m4a",
    ]);
  });

  it("erkennt Art, Länge und Prüfsumme", () => {
    expect(byName("C0012.MP4").kind).toBe("video");
    expect(byName("C0012.MP4").durationMs).toBeGreaterThanOrEqual(1900);
    expect(byName("ZOOM0004.m4a").kind).toBe("audio");
    expect(byName("Tagebuch_S01.jpg").kind).toBe("diary");
    expect(byName("IMG_0231.jpg").kind).toBe("photo");
    expect(byName("IMG_0231.jpg").sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("liest Zeitbelege aus Metadaten, EXIF und Dateinamen", () => {
    expect(byName("C0012.MP4").evidence.map((e) => [e.kind, formatClock(e.localMs)])).toEqual([
      ["metadata", "10:18:47"],
    ]);
    expect(byName("IMG_0231.jpg").evidence.map((e) => [e.detail, formatClock(e.localMs)])).toEqual([
      ["EXIF", "10:12:34"],
    ]);
    expect(byName("IMG_20260914_104050.jpg").evidence.map((e) => e.kind)).toEqual(["filename"]);
    expect(byName("Tagebuch_S01.jpg").evidence).toEqual([]);
  });

  it("gruppiert nach Gerät: Modell aus EXIF, sonst Dateinamen-Familie", () => {
    expect(byName("C0012.MP4").deviceKey).toBe(byName("C0013.MP4").deviceKey);
    expect(byName("IMG_0231.jpg").deviceLabel).toBe("Beispiel Handy Testperson A");
    expect(byName("IMG_0231.jpg").deviceKey).not.toBe(byName("IMG_20260914_104050.jpg").deviceKey);
  });

  it("übernimmt den Plan ins Projekt und ordnet nach Anker richtig ein", () => {
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Testmarkt", date: "2026-09-14" });
    const res = applyImport(store, session.id, plan);
    expect(res.sources).toHaveLength(6);
    expect(res.devicesCreated).toHaveLength(5);
    expect(res.sources.map((s) => s.label).sort()).toEqual(["A-01", "F-001", "F-002", "T-01", "V-01", "V-02"]);

    const src = (n: string) => res.sources.find((s) => s.fileName === n)!;
    store.setReferenceDevice(src("ZOOM0004.m4a").deviceId!);
    store.addAnchor({
      sessionId: session.id,
      kind: "clap",
      a: { sourceId: src("ZOOM0004.m4a").id, atMediaMs: 80_000 },
      b: { sourceId: src("C0012.MP4").id, atMediaMs: 20_000 },
    });
    const tl = resolveTimeline(store.loadResolveInput(session.id));
    expect(formatClock(tl.placements.get(src("C0012.MP4").id)!.startMs)).toBe("10:16:00");
    expect(formatClock(tl.placements.get(src("C0013.MP4").id)!.startMs)).toBe("10:40:10");

    // Zweiter Import derselben Dateien legt nichts doppelt an.
    const again = applyImport(store, session.id, plan);
    expect(again.sources).toHaveLength(0);
    expect(again.duplicates).toHaveLength(6);
    store.close();
  });

  it("BWF-Aufnahmezeit aus WAV-Dateien von Rekordern", async () => {
    const wav = join(dir, "ZOOM0005.WAV");
    makeAudio(wav, { seconds: 1, bwf: { date: "2026-09-14", time: "11:02:03" } });
    const [c] = await scanPaths([wav]);
    expect(c!.evidence.map((e) => [e.detail, formatClock(e.localMs)])).toEqual([
      ["Metadaten (BWF Aufnahmebeginn)", "11:02:03"],
    ]);
  });
});
