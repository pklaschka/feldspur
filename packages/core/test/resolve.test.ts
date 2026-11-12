import { describe, expect, it } from "vite-plus/test";
import { combineUncertainty, resolveTimeline } from "../src/resolve.ts";
import { formatClock } from "../src/time.ts";
import { T, testmarkt } from "./scenario.ts";

const clock = (ms: number | undefined) => (ms === undefined ? undefined : formatClock(ms));

describe("Zeitbestimmung am Testmarkt", () => {
  const input = testmarkt();
  const res = resolveTimeline(input);
  const p = (id: string) => res.placements.get(id)!;

  it("Referenzuhr: Diktiergerät aus Metadaten, sicher", () => {
    expect(clock(p("ZOOM0004.m4a").startMs)).toBe("10:15:00");
    expect(clock(p("ZOOM0004.m4a").endMs)).toBe("10:41:30");
    expect(p("ZOOM0004.m4a").status).toBe("ok");
  });

  it("Kamera: Abweichung +2:47 aus dem Klatschen, gilt für beide Clips", () => {
    const cam = res.deviceClocks.get("camA")!;
    expect(cam.offsetMs).toBe(167_000);
    expect(cam.basis).toBe("anchor");
    expect(clock(p("C0012.MP4").startMs)).toBe("10:16:00");
    expect(clock(p("C0013.MP4").startMs)).toBe("10:40:10");
    expect(p("C0013.MP4").deviceCorrectionMs).toBe(-167_000);
    expect(p("C0012.MP4").status).toBe("ok");
    expect(p("C0013.MP4").status).toBe("ok");
  });

  it("Handy A: manuell bekannte Abweichung −0:04", () => {
    expect(clock(p("IMG_0231.jpg").startMs)).toBe("10:12:30");
    expect(clock(p("IMG_0232.jpg").startMs)).toBe("10:16:45");
    expect(p("IMG_0231.jpg").status).toBe("ok");
  });

  it("Handy B: nur Dateiname, Uhr unbekannt → prüfen", () => {
    expect(clock(p("IMG_20260914_104050.jpg").startMs)).toBe("10:40:50");
    expect(p("IMG_20260914_104050.jpg").status).toBe("check");
    expect(p("IMG_20260914_104050.jpg").notes).toContain("Uhr weicht ab?");
  });

  it("Tagebuch: Bezugszeitraum reicht vor die Notierzeit zurück", () => {
    expect(clock(res.diary.get("d1")!.fromMs)).toBe("10:05:00");
    expect(clock(res.diary.get("d2")!.fromMs)).toBe("10:17:00");
    expect(clock(p("Tagebuch_S01.jpg").startMs)).toBe("10:05:00");
    expect(clock(p("Tagebuch_S01.jpg").endMs)).toBe("10:12:00");
  });

  it("keine Widersprüche", () => {
    expect(res.anchorConflicts).toEqual([]);
    for (const pl of res.placements.values()) expect(pl.conflicts).toEqual([]);
  });
});

describe("Zeitbestimmung: Sonderfälle", () => {
  it("Quelle ohne eigene Zeit erbt die Lage über einen Anker", () => {
    const input = testmarkt();
    input.sources.push({ ...input.sources[1]!, id: "LEIH.MP4", label: "V-03", deviceId: "leih" });
    input.anchors.push({
      id: "clap2",
      sessionId: "s1",
      kind: "clap",
      a: { sourceId: "C0013.MP4", atMediaMs: 20_000 }, // 10:40:30
      b: { sourceId: "LEIH.MP4", atMediaMs: 5_000 },
      uncertaintyMs: 50,
      note: "",
      enabled: true,
      proposed: false,
      confidence: null,
    });
    const res = resolveTimeline(input);
    const pl = res.placements.get("LEIH.MP4")!;
    expect(formatClock(pl.startMs)).toBe("10:40:25");
    expect(pl.basis.kind).toBe("anchor");
    expect(pl.basis.detail).toBe("Sync-Signal mit V-02");
    expect(pl.status).toBe("ok");
  });

  it("ohne Belege bleibt eine Quelle unplatziert", () => {
    const input = testmarkt();
    input.sources.push({ ...input.sources[1]!, id: "LEIH.MP4", label: "V-03", deviceId: "leih" });
    expect(resolveTimeline(input).placements.has("LEIH.MP4")).toBe(false);
  });

  it("manuelle Platzierung gewinnt, Widerspruch wird gemeldet", () => {
    const input = testmarkt();
    input.evidence.push({
      id: "man",
      sourceId: "IMG_0231.jpg",
      kind: "manual",
      clock: "true",
      atMediaMs: 0,
      localMs: T(10, 20),
      utcMs: null,
      uncertaintyMs: 60_000,
      detail: "von Hand",
      raw: "",
      enabled: true,
    });
    const pl = resolveTimeline(input).placements.get("IMG_0231.jpg")!;
    expect(formatClock(pl.startMs)).toBe("10:20:00");
    expect(pl.status).toBe("check");
    expect(pl.conflicts).toHaveLength(1);
    expect(pl.conflicts[0]!.differenceMs).toBe(T(10, 12, 30) - T(10, 20));
  });

  it("abgeschalteter Beleg zählt nicht", () => {
    const input = testmarkt();
    input.evidence.find((e) => e.sourceId === "IMG_0231.jpg")!.enabled = false;
    expect(resolveTimeline(input).placements.has("IMG_0231.jpg")).toBe(false);
  });

  it("Geräteeinstellung „Zeitstempel sind UTC“ rechnet in Ortszeit um", () => {
    const input = testmarkt();
    const ev = input.evidence.find((e) => e.sourceId === "IMG_20260914_104050.jpg")!;
    ev.utcMs = Date.UTC(2026, 8, 14, 8, 40, 50);
    input.devices.find((d) => d.id === "phoneB")!.timestampsAreUtc = true;
    const pl = resolveTimeline(input).placements.get("IMG_20260914_104050.jpg")!;
    expect(formatClock(pl.startMs)).toBe("10:40:50");
  });

  it("ohne Referenzuhr ist nichts sicher", () => {
    const input = testmarkt();
    for (const d of input.devices) {
      d.isReference = false;
      d.offsetBasis = "unknown";
    }
    const res = resolveTimeline(input);
    expect(res.placements.get("ZOOM0004.m4a")!.notes).toContain("Keine Referenzuhr gewählt");
    expect(res.deviceClocks.get("camA")!.offsetMs).toBeNull();
  });

  it("widersprüchlicher zweiter Anker wird gemeldet", () => {
    const input = testmarkt();
    input.anchors.push({
      id: "bad",
      sessionId: "s1",
      kind: "manual",
      a: { sourceId: "ZOOM0004.m4a", atMediaMs: 1_530_000 }, // 10:40:30
      b: { sourceId: "C0013.MP4", atMediaMs: 30_000 }, // laut Kamera 10:40:40
      uncertaintyMs: 50,
      note: "",
      enabled: true,
      proposed: false,
      confidence: null,
    });
    const res = resolveTimeline(input);
    expect(res.anchorConflicts).toEqual([{ anchorId: "bad", differenceMs: 10_000 }]);
  });

  it("Unsicherheiten addieren sich quadratisch", () => {
    expect(combineUncertainty(3000, 4000)).toBe(5000);
  });
});
