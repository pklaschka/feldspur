import { describe, expect, it } from "vite-plus/test";
import { combineUncertainty, resolveTimeline } from "../src/resolve.ts";
import { formatClock } from "../src/time.ts";
import { CONTEXT_DEFAULTS, T, testmarkt } from "./scenario.ts";

const clock = (ms: number | undefined) => (ms === undefined ? undefined : formatClock(ms));

describe("Zeitbestimmung am Testmarkt", () => {
  // Angenommen: der erfundene Markttag aus scenario.ts (Rekorder als Referenz, Kamera mit Klatschen, zwei Handys)
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
    expect(clock(p("Tagebuch_S01.jpg").startMs)).toBe("10:12:00");
    expect(clock(p("Tagebuch_S01.jpg").endMs)).toBe("10:12:00");
  });

  it("am Testmarkt gibt es keine Widersprüche", () => {
    expect(res.anchorConflicts).toEqual([]);
    for (const pl of res.placements.values()) expect(pl.conflicts).toEqual([]);
  });
});

describe("Zeitbestimmung: Sonderfälle", () => {
  it("Quelle ohne eigene Zeit erbt die Lage über einen Anker", () => {
    // Angenommen: ein Leihgerät ohne eigene Zeit, per Klatschen mit dem zweiten Kameraclip verbunden
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
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    const pl = res.placements.get("LEIH.MP4")!;
    // Dann: liegt es über den Anker 5 s vor dem Klatschen
    expect(formatClock(pl.startMs)).toBe("10:40:25");
    expect(pl.basis.kind).toBe("anchor");
    expect(pl.basis.detail).toBe("Sync-Signal mit V-02");
    expect(pl.status).toBe("ok");
  });

  it("ohne Belege bleibt eine Quelle unplatziert", () => {
    // Angenommen: dasselbe Leihgerät, aber ohne Anker
    const input = testmarkt();
    input.sources.push({ ...input.sources[1]!, id: "LEIH.MP4", label: "V-03", deviceId: "leih" });
    // Dann: bekommt es keinen Platz auf der Zeitachse
    expect(resolveTimeline(input).placements.has("LEIH.MP4")).toBe(false);
  });

  it("manuelle Platzierung gewinnt, Widerspruch wird gemeldet", () => {
    // Angenommen: ein Foto mit Metadaten 10:12:30 bekommt von Hand 10:20
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
    // Wenn: Feldspur die Zeitachse berechnet
    const pl = resolveTimeline(input).placements.get("IMG_0231.jpg")!;
    // Dann: gilt die Handeingabe, und der Unterschied zu den Metadaten wird gemeldet
    expect(formatClock(pl.startMs)).toBe("10:20:00");
    expect(pl.status).toBe("check");
    expect(pl.conflicts).toHaveLength(1);
    expect(pl.conflicts[0]!.differenceMs).toBe(T(10, 12, 30) - T(10, 20));
  });

  it("angesagte Uhrzeit in einem Clip gleicht die ganze Kamera ab", () => {
    // Angenommen: kein Klatschen, aber eine angesagte Uhrzeit im zweiten Kameraclip
    const input = testmarkt();
    input.anchors = [];
    // Im zweiten Clip sagt jemand bei 0:30 „zehn Uhr vierzig und vierzig Sekunden“.
    input.evidence.push({
      id: "ansage",
      sourceId: "C0013.MP4",
      kind: "spoken",
      clock: "true",
      atMediaMs: 30_000,
      localMs: T(10, 40, 40),
      utcMs: null,
      uncertaintyMs: 2_000,
      detail: "angesagt",
      raw: "",
      enabled: true,
    });
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: gilt die Abweichung für die ganze Kamera, auch für den ersten Clip
    const cam = res.deviceClocks.get("camA")!;
    expect(cam.basis).toBe("spoken");
    expect(cam.offsetMs).toBe(167_000);
    // Der erste Clip hat keine Ansage, liegt aber über die abgeglichene Uhr richtig.
    expect(formatClock(res.placements.get("C0012.MP4")!.startMs)).toBe("10:16:00");
    expect(res.placements.get("C0012.MP4")!.status).toBe("check"); // ± 2,2 s
  });

  it("Anker schlägt eine minutengenaue Ansage derselben Kamera (#117)", () => {
    // Angenommen: Klatschen und eine auf die Minute gerundete Ansage in derselben Kamera
    const input = testmarkt();
    // Angesagt „zehn Uhr vierzig“ bei 0:30, auf die Minute gerundet: 20 s neben dem Klatschen.
    input.evidence.push({
      id: "ansage",
      sourceId: "C0013.MP4",
      kind: "spoken",
      clock: "true",
      atMediaMs: 30_000,
      localMs: T(10, 40, 20),
      utcMs: null,
      uncertaintyMs: 60_000,
      detail: "angesagt",
      raw: "",
      enabled: true,
    });
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: gilt der genauere Anker, ohne Widerspruch
    const cam = res.deviceClocks.get("camA")!;
    expect(cam.basis).toBe("anchor");
    expect(cam.offsetMs).toBe(167_000);
    expect(formatClock(res.placements.get("C0012.MP4")!.startMs)).toBe("10:16:00");
    expect(formatClock(res.placements.get("C0013.MP4")!.startMs)).toBe("10:40:10");
    expect(res.anchorConflicts).toEqual([]);
  });

  it("Anker gilt weiter, wenn der verankerte Clip selbst bestätigt ist (#117)", () => {
    // Angenommen: Klatschen, minutengenaue Ansage und „Lage passt“ auf dem verankerten Clip
    const input = testmarkt();
    input.evidence.push(
      {
        id: "ansage",
        sourceId: "C0013.MP4",
        kind: "spoken",
        clock: "true",
        atMediaMs: 30_000,
        localMs: T(10, 40, 20),
        utcMs: null,
        uncertaintyMs: 60_000,
        detail: "angesagt",
        raw: "",
        enabled: true,
      },
      // „Lage passt“ auf den verankerten Clip: folgt den Metadaten, hängt also weiter an der Kamerauhr.
      {
        id: "chk",
        sourceId: "C0012.MP4",
        kind: "checked",
        clock: "true",
        atMediaMs: 0,
        localMs: T(10, 16),
        utcMs: null,
        uncertaintyMs: 1_000,
        detail: "Geprüft: Lage passt",
        raw: "",
        enabled: true,
        decision: {
          at: "2026-11-19T16:00:00.000Z",
          basisId: "ev:C0012.MP4:metadata",
          basisKind: "metadata",
          reason: "",
          seen: [{ id: "ev:C0012.MP4:metadata", kind: "metadata", differenceMs: 0 }],
        },
      },
    );
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: bleibt die Kamera am Anker, der bestätigte Clip behält seine Lage
    expect(res.deviceClocks.get("camA")!.basis).toBe("anchor");
    expect(formatClock(res.placements.get("C0012.MP4")!.startMs)).toBe("10:16:00");
    expect(res.placements.get("C0012.MP4")!.basis.kind).toBe("checked");
    expect(formatClock(res.placements.get("C0013.MP4")!.startMs)).toBe("10:40:10");
  });

  it("Anker schlägt eine von Hand eingetragene Abweichung derselben Kamera", () => {
    // Angenommen: Die Kamera-Abweichung ist von Hand auf +2:45 geschätzt, das Klatschen misst +2:47
    const input = testmarkt();
    const cam = input.devices.find((d) => d.id === "camA")!;
    Object.assign(cam, { clockOffsetMs: 165_000, clockOffsetUncertaintyMs: 1_000, offsetBasis: "manual" });
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: gilt der Anker für die ganze Kamera, ohne Widerspruch
    expect(res.deviceClocks.get("camA")!.basis).toBe("anchor");
    expect(res.deviceClocks.get("camA")!.offsetMs).toBe(167_000);
    expect(formatClock(res.placements.get("C0013.MP4")!.startMs)).toBe("10:40:10");
    expect(res.anchorConflicts).toEqual([]);
  });

  it("Anker schlägt die Handeingabe auch, wenn der verankerte Clip über eine Ansage liegt", () => {
    // Angenommen: Abweichung von Hand +2:45, im verankerten Clip eine sekundengenaue Ansage (wie am 08.09.)
    const input = testmarkt();
    const cam = input.devices.find((d) => d.id === "camA")!;
    Object.assign(cam, { clockOffsetMs: 165_000, clockOffsetUncertaintyMs: 1_000, offsetBasis: "manual" });
    input.evidence.push({
      id: "ansage",
      sourceId: "C0012.MP4",
      kind: "spoken",
      clock: "true",
      atMediaMs: 10_000,
      localMs: T(10, 16, 10),
      utcMs: null,
      uncertaintyMs: 1_000,
      detail: "angesagt",
      raw: "",
      enabled: true,
    });
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: richtet der Anker die Kamerauhr, und der zweite Clip folgt ihr
    expect(res.deviceClocks.get("camA")!.basis).toBe("anchor");
    expect(res.deviceClocks.get("camA")!.offsetMs).toBe(167_000);
    expect(formatClock(res.placements.get("C0013.MP4")!.startMs)).toBe("10:40:10");
  });

  /** Kamera von Hand um 28 s daneben geschätzt, dazu ein Anker vom ersten Clip zu einem Foto von Handy B (#228). */
  const fotoAnKamera = (opts: { swap?: boolean; fotoZuerst?: boolean; klatschen?: boolean } = {}) => {
    const input = testmarkt();
    const cam = input.devices.find((d) => d.id === "camA")!;
    Object.assign(cam, { clockOffsetMs: 195_000, clockOffsetUncertaintyMs: 1_000, offsetBasis: "manual" });
    const clip = { sourceId: "C0012.MP4", atMediaMs: 5_000 };
    const foto = { sourceId: "IMG_20260914_104050.jpg", atMediaMs: 0 };
    const anchor = {
      ...input.anchors[0]!,
      id: "foto",
      kind: "manual" as const,
      a: opts.swap ? foto : clip,
      b: opts.swap ? clip : foto,
    };
    if (opts.klatschen === false) input.anchors[0]!.enabled = false;
    input.anchors = opts.fotoZuerst ? [anchor, ...input.anchors] : [...input.anchors, anchor];
    return input;
  };

  it.each`
    reihenfolge            | swap     | fotoZuerst
    ${"Klatschen zuerst"}  | ${false} | ${false}
    ${"Foto-Anker zuerst"} | ${false} | ${true}
    ${"Seiten vertauscht"} | ${true}  | ${true}
  `(
    "Ankerkette über eine von Hand geschätzte Kamera zieht das Foto mit ($reihenfolge, #228)",
    ({ swap, fotoZuerst }) => {
      // Angenommen: Kamera von Hand +3:15 (wahr +2:47), Foto von Handy B per Anker an Clip V-01 bei 0:05
      const input = fotoAnKamera({ swap, fotoZuerst });
      // Wenn: das Klatschen die Kamera an die Referenz bindet
      const res = resolveTimeline(input);
      // Dann: rückt das Foto mit der Kamera, und kein Anker widerspricht
      expect(res.deviceClocks.get("camA")!.offsetMs).toBe(167_000);
      expect(clock(res.placements.get("IMG_20260914_104050.jpg")!.startMs)).toBe("10:16:05");
      expect(res.placements.get("IMG_20260914_104050.jpg")!.status).toBe("ok");
      expect(res.anchorConflicts).toEqual([]);
    },
  );

  it("ein Anker zu einem Foto ohne abgeglichene Uhr misst die von Hand geschätzte Kamera nicht (#228)", () => {
    // Angenommen: Kamera von Hand +3:15, kein Klatschen, nur der Anker Foto = V-01 bei 0:05
    const input = fotoAnKamera({ klatschen: false });
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: bleibt die Kamera bei der Handeingabe, das Foto folgt ihr, der zweite Clip liegt wie ohne den Anker
    const ohne = resolveTimeline({ ...input, anchors: [] });
    expect(res.deviceClocks.get("camA")!.basis).toBe("manual");
    expect(res.deviceClocks.get("phoneB")!.basis).toBe("anchor");
    expect(clock(res.placements.get("IMG_20260914_104050.jpg")!.startMs)).toBe("10:15:37");
    expect(res.placements.get("C0013.MP4")).toEqual(ohne.placements.get("C0013.MP4"));
  });

  it("ohne Anker gilt wieder die Handeingabe", () => {
    // Angenommen: Abweichung von Hand +2:45, das Klatschen ist abgeschaltet
    const input = testmarkt();
    const cam = input.devices.find((d) => d.id === "camA")!;
    Object.assign(cam, { clockOffsetMs: 165_000, clockOffsetUncertaintyMs: 1_000, offsetBasis: "manual" });
    input.anchors[0]!.enabled = false;
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: zählt die eingetragene Abweichung
    expect(res.deviceClocks.get("camA")!.basis).toBe("manual");
    expect(formatClock(res.placements.get("C0013.MP4")!.startMs)).toBe("10:40:12");
  });

  it("abgeschalteter Beleg zählt nicht", () => {
    // Angenommen: der einzige Beleg eines Fotos ist abgeschaltet
    const input = testmarkt();
    input.evidence.find((e) => e.sourceId === "IMG_0231.jpg")!.enabled = false;
    // Dann: hat das Foto keinen Platz auf der Zeitachse
    expect(resolveTimeline(input).placements.has("IMG_0231.jpg")).toBe(false);
  });

  it("Geräteeinstellung „Zeitstempel sind UTC“ rechnet in Ortszeit um", () => {
    // Angenommen: Handy B schreibt UTC, und am Gerät ist „Zeitstempel sind UTC“ gesetzt
    const input = testmarkt();
    const ev = input.evidence.find((e) => e.sourceId === "IMG_20260914_104050.jpg")!;
    ev.utcMs = Date.UTC(2026, 8, 14, 8, 40, 50);
    input.devices.find((d) => d.id === "phoneB")!.timestampsAreUtc = true;
    // Wenn: Feldspur die Zeitachse berechnet
    const pl = resolveTimeline(input).placements.get("IMG_20260914_104050.jpg")!;
    // Dann: liegt das Foto in Berliner Ortszeit
    expect(formatClock(pl.startMs)).toBe("10:40:50");
  });

  it("Zeitzone der Geräteuhr: Ortszeit-Belege werden in die Einsatzzeit umgerechnet", () => {
    // Angenommen: Handy B ist auf UTC gestellt und am Gerät steht die Zeitzone UTC
    const input = testmarkt();
    const ev = input.evidence.find((e) => e.sourceId === "IMG_20260914_104050.jpg")!;
    ev.localMs = Date.UTC(2026, 8, 14, 8, 40, 50); // Handy auf UTC gestellt
    input.devices.find((d) => d.id === "phoneB")!.timeZone = "UTC";
    // Wenn: Feldspur die Zeitachse berechnet
    const pl = resolveTimeline(input).placements.get("IMG_20260914_104050.jpg")!;
    // Dann: liegt das Foto in der Einsatzzeit
    expect(formatClock(pl.startMs)).toBe("10:40:50");
  });

  it("Zeitzone gilt nicht für angesagte oder von Hand gesetzte Zeiten", () => {
    // Angenommen: das Gerät steht auf New York, die Uhrzeit wurde aber von Hand gesetzt
    const input = testmarkt();
    input.devices.find((d) => d.id === "phoneB")!.timeZone = "America/New_York";
    const ev = input.evidence.find((e) => e.sourceId === "IMG_20260914_104050.jpg")!;
    ev.kind = "manual";
    ev.clock = "true";
    // Wenn: Feldspur die Zeitachse berechnet
    const pl = resolveTimeline(input).placements.get("IMG_20260914_104050.jpg")!;
    // Dann: bleibt die Handeingabe unverändert
    expect(formatClock(pl.startMs)).toBe("10:40:50");
  });

  it("ohne Referenzuhr ist keine Lage sicher", () => {
    // Angenommen: kein Gerät ist Referenz, keine Abweichung bekannt
    const input = testmarkt();
    for (const d of input.devices) {
      d.isReference = false;
      d.offsetBasis = "unknown";
    }
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: weist es darauf hin, und keine Kamerauhr ist abgeglichen
    expect(res.placements.get("ZOOM0004.m4a")!.notes).toContain("Keine Referenzuhr gewählt");
    expect(res.deviceClocks.get("camA")!.offsetMs).toBeNull();
  });

  it("widersprüchlicher zweiter Anker wird gemeldet", () => {
    // Angenommen: ein zweiter Anker, der 10 s neben dem Klatschen liegt
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
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: wird er mit dem Unterschied gemeldet
    expect(res.anchorConflicts).toEqual([{ anchorId: "bad", differenceMs: 10_000 }]);
    // und: beide verankerten Aufnahmen sind nicht mehr „sicher“
    for (const id of ["ZOOM0004.m4a", "C0013.MP4"]) {
      expect(res.placements.get(id)!.status).toBe("check");
      expect(res.placements.get(id)!.notes).toContain("Anker widerspricht um 0:10");
    }
    // und: Aufnahmen ohne diesen Anker bleiben, wie sie waren
    expect(res.placements.get("C0012.MP4")!.status).toBe("ok");
  });

  it("Unsicherheiten addieren sich quadratisch", () => {
    expect(combineUncertainty(3000, 4000)).toBe(5000);
  });
});

describe("Folgeaufnahmen und Seiten aus mehreren Bildern", () => {
  it("eine Folgeaufnahme beginnt am Ende der Vorgängerdatei, auch über mehrere Glieder", () => {
    // Angenommen: zwei Folgeaufnahmen hängen hintereinander an A-01
    const input = testmarkt();
    const base = input.sources.find((s) => s.id === "ZOOM0004.m4a")!;
    input.sources.push(
      {
        ...base,
        id: "ZOOM0004_002.m4a",
        label: "A-02",
        fileName: "ZOOM0004_002.m4a",
        durationMs: 600_000,
        follows: "ZOOM0004.m4a",
      },
      {
        ...base,
        id: "ZOOM0004_003.m4a",
        label: "A-03",
        fileName: "ZOOM0004_003.m4a",
        durationMs: 60_000,
        follows: "ZOOM0004_002.m4a",
      },
    );
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: beginnt jede am Ende der vorigen
    const two = res.placements.get("ZOOM0004_002.m4a")!;
    expect(clock(two.startMs)).toBe("10:41:30");
    expect(two.basis.kind).toBe("follows");
    expect(two.basis.detail).toBe("Folgeaufnahme von A-01");
    expect(two.status).toBe("ok");
    expect(clock(res.placements.get("ZOOM0004_003.m4a")!.startMs)).toBe("10:51:30");
  });

  it("eine eigene Handeingabe geht der Verkettung vor", () => {
    // Angenommen: eine Folgeaufnahme hat zusätzlich eine Uhrzeit von Hand
    const input = testmarkt();
    const base = input.sources.find((s) => s.id === "ZOOM0004.m4a")!;
    input.sources.push({
      ...base,
      id: "Z2",
      label: "A-02",
      fileName: "Z2",
      durationMs: 60_000,
      follows: "ZOOM0004.m4a",
    });
    input.evidence.push({
      id: "ev:Z2",
      sourceId: "Z2",
      kind: "manual",
      clock: "true",
      atMediaMs: 0,
      localMs: T(11, 0),
      utcMs: null,
      uncertaintyMs: 1000,
      detail: "Von Hand",
      raw: "",
      enabled: true,
    });
    // Dann: gilt die Handeingabe
    expect(clock(resolveTimeline(input).placements.get("Z2")!.startMs)).toBe("11:00:00");
  });

  it("ein weiteres Bild einer Seite liegt wie die Hauptquelle, Rahmen darauf zählen für sie", () => {
    // Angenommen: ein zweites Bild von Tagebuchseite 2, darauf ein Rahmen notiert um 10:35
    const input = testmarkt();
    const page = input.sources.find((s) => s.id === "Tagebuch_S02.jpg")!;
    input.sources.push({ ...page, id: "S02b", label: "T-03", fileName: "S02b.jpg", partOf: "Tagebuch_S02.jpg" });
    input.diaryEntries.push({
      id: "d9",
      sessionId: "s1",
      regions: [{ sourceId: "S02b", page: 0, x: 0, y: 0, w: 1, h: 0.5 }],
      notedAtMs: T(10, 35),
      lookbackMs: null,
      mode: "short",
      shortText: "",
      fullText: "",
      ...CONTEXT_DEFAULTS,
    });
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: zählt der Rahmen für die Seite, und das Bild liegt wie die Seite
    const main = res.placements.get("Tagebuch_S02.jpg")!;
    const part = res.placements.get("S02b")!;
    expect(clock(main.endMs)).toBe("10:35:00");
    expect([part.startMs, part.endMs]).toEqual([main.startMs, main.endMs]);
    expect(part.basis.kind).toBe("part");
  });
});
