import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveLocal, formatClock, ProjectStore, resolveTimeline } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { applyImport, scanPaths, type ImportCandidate } from "../src/import.ts";
import { hasFfmpeg, makeAudio, makeFieldDay, makeVideo } from "./fixtures.ts";

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
      ["metadata", "08:18:47"], // wie geschrieben; umgerechnet wird beim Einordnen
    ]);
    expect(new Date(byName("C0012.MP4").evidence[0]!.utcMs!).toISOString()).toBe("2026-09-14T08:18:47.000Z");
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

  it("liest creation_time mit „Z“ als UTC und rechnet in Ortszeit um", async () => {
    const sub = join(dir, "utc");
    mkdirSync(sub);
    makeVideo(join(sub, "MVI_0001.MP4"), { seconds: 1, creationTime: "2026-09-07T11:29:15.000000Z" });
    const cands = await scanPaths([sub]);
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Beispiel", date: "2026-09-07" });
    const res = applyImport(store, session.id, cands);
    expect(res.devicesCreated[0]!.timestampsAreUtc).toBe(true);
    const tl = resolveTimeline(store.loadResolveInput(session.id));
    expect(formatClock(tl.placements.get(res.sources[0]!.id)!.startMs)).toBe("13:29:15");
    store.close();
  });

  it("erkennt Geräte, die Ortszeit mit „Z“ schreiben, am Dateinamen", async () => {
    const sub = join(dir, "ortszeit");
    mkdirSync(sub);
    makeVideo(join(sub, "VID_20260907_140003.mp4"), { seconds: 1, creationTime: "2026-09-07T14:00:00.000000Z" });
    makeVideo(join(sub, "VID_20260907_141502.mp4"), { seconds: 1, creationTime: "2026-09-07T14:15:00.000000Z" });
    const cands = await scanPaths([sub]);
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Beispiel", date: "2026-09-07" });
    const res = applyImport(store, session.id, cands);
    expect(res.devicesCreated).toHaveLength(1);
    expect(res.devicesCreated[0]!.timestampsAreUtc).toBe(false);
    const input = store.loadResolveInput(session.id);
    const first = res.sources.find((s) => s.fileName.endsWith("140003.mp4"))!;
    const meta = input.evidence.find((e) => e.sourceId === first.id && e.kind === "metadata")!;
    expect(formatClock(effectiveLocal(meta, input.devices[0], input.session.timeZone))).toBe("14:00:00");
    store.close();
  });
});
