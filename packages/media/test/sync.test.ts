import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, ProjectStore, resolveTimeline } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { analyzeSession, sessionEpisodes } from "../src/analyze.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { hasFfmpeg, makeSyncDay } from "./fixtures.ts";

describe.skipIf(!hasFfmpeg())("Abgleich und Episoden an einem erzeugten Feldtag", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  const src = (n: string) => store.listSources(sessionId).find((s) => s.fileName === n)!;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-sync-"));
    makeSyncDay(dir);
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Sync", date: "2026-09-14" }).id;
    applyImport(store, sessionId, await scanPaths([dir]));
    store.setReferenceDevice(src("ZOOM0001.m4a").deviceId!);
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("schlägt für beide Clips das Klatschen vor, mit Kamera +2:47", async () => {
    const r = await analyzeSession(store, sessionId);
    expect(r.failed).toEqual([]);
    expect(r.analyzed).toBe(3);
    const byClip = new Map(r.proposals.map((p) => [p.sourceId, p]));
    const p1 = byClip.get(src("C0001.MP4").id)!;
    const p2 = byClip.get(src("C0002.MP4").id)!;
    expect(p1.method).toBe("clap");
    expect(p1.confidence).toBe("high");
    expect(Math.abs(p1.impliedDeviceOffsetMs! - 167_000)).toBeLessThanOrEqual(30);
    expect(Math.abs(p1.refAtMs - 80_000)).toBeLessThanOrEqual(30);
    expect(Math.abs(p2.refAtMs - 502_500)).toBeLessThanOrEqual(30);
  });

  it("Vorschläge zählen erst nach Bestätigung", () => {
    const before = resolveTimeline(store.loadResolveInput(sessionId));
    expect(before.deviceClocks.get(src("C0001.MP4").deviceId!)!.offsetMs).toBeNull();
    const proposed = store.listAnchors(sessionId).filter((a) => a.proposed);
    expect(proposed).toHaveLength(2);
    store.confirmAnchor(proposed[0]!.id);
    const after = resolveTimeline(store.loadResolveInput(sessionId));
    expect(formatClock(after.placements.get(src("C0001.MP4").id)!.startMs)).toBe("10:16:00");
    expect(formatClock(after.placements.get(src("C0002.MP4").id)!.startMs)).toBe("10:23:00");
  });

  it("zweite Analyse nutzt den Zwischenspeicher", async () => {
    const r = await analyzeSession(store, sessionId);
    expect(r.analyzed).toBe(0);
    // Nach der Bestätigung ist nichts mehr offen.
    expect(store.listAnchors(sessionId).filter((a) => a.proposed)).toHaveLength(0);
  });

  it("teilt den Tag in zwei Episoden, die Stille dazwischen ist Leerlauf", () => {
    const { episodes, gaps } = sessionEpisodes(store, sessionId);
    expect(episodes.map((e) => [formatClock(e.startMs), formatClock(e.endMs)])).toEqual([
      ["10:15:00", "10:16:30"],
      ["10:22:50", "10:25:00"],
    ]);
    expect(episodes[1]!.sourceIds).toContain(src("C0002.MP4").id);
    expect(gaps.map((g) => [formatClock(g.startMs), formatClock(g.endMs)])).toEqual([["10:16:30", "10:22:50"]]);
    const analysis = store.listAudioAnalyses(sessionId).find((a) => a.sourceId === src("ZOOM0001.m4a").id)!;
    // Wachhund: das Klatschen bei 5:00 mitten in der Stille wird gemeldet.
    expect(analysis.loudInIdle.some((l) => Math.abs(l.atMs - 300_000) < 200)).toBe(true);
  });
});
