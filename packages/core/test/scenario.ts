/**
 * Der erfundene Markttag aus dem Testpaket als reines Datenmodell
 * (ohne Dateien), damit die Zeitbestimmung isoliert prüfbar ist.
 */
import type { Device, DiaryEntry, FieldSession, Source, SyncAnchor, TimeEvidence } from "../src/model.ts";
import { localMs } from "../src/time.ts";

export const T = (h: number, m: number, s = 0) => localMs(2026, 9, 14, h, m, s);

export function testmarkt() {
  const session: FieldSession = {
    id: "s1",
    title: "Testmarkt",
    date: "2026-09-14",
    place: "Testmarkt",
    timeZone: "Europe/Berlin",
    diaryLookbackMs: 15 * 60_000,
    extra: {},
  };
  const dev = (id: string, label: string, extra: Partial<Device> = {}): Device => ({
    id,
    sessionId: "s1",
    label,
    personId: null,
    matchKey: id,
    isReference: false,
    clockOffsetMs: 0,
    clockOffsetUncertaintyMs: 0,
    offsetBasis: "unknown",
    timestampsAreUtc: false,
    filenamePattern: null,
    ...extra,
  });
  const devices = [
    dev("zoom", "Diktiergerät", { isReference: true, offsetBasis: "reference" }),
    dev("camA", "Kamera A"),
    dev("phoneA", "Handy A", { clockOffsetMs: 4_000, clockOffsetUncertaintyMs: 1_000, offsetBasis: "manual" }),
    dev("phoneB", "Handy B"),
    dev("diary", "Tagebuch"),
    dev("leih", "Leihkamera"),
  ];
  const src = (
    id: string,
    label: string,
    kind: Source["kind"],
    deviceId: string,
    durationMs: number | null,
  ): Source => ({
    id,
    sessionId: "s1",
    deviceId,
    label,
    kind,
    title: id,
    originalPath: `/feld/${id}`,
    fileName: id,
    sizeBytes: 1,
    sha256: "0".repeat(64),
    durationMs,
    metadata: {},
    importedAt: "2026-11-12T00:00:00.000Z",
  });
  const sources = [
    src("ZOOM0004.m4a", "A-01", "audio", "zoom", 1_590_000),
    src("C0012.MP4", "V-01", "video", "camA", 60_000),
    src("C0013.MP4", "V-02", "video", "camA", 60_000),
    src("IMG_0231.jpg", "F-001", "photo", "phoneA", null),
    src("IMG_0232.jpg", "F-002", "photo", "phoneA", null),
    src("IMG_20260914_104050.jpg", "F-003", "photo", "phoneB", null),
    src("Tagebuch_S01.jpg", "T-01", "diary", "diary", null),
    src("Tagebuch_S02.jpg", "T-02", "diary", "diary", null),
  ];
  const ev = (
    sourceId: string,
    kind: TimeEvidence["kind"],
    local: number,
    unc: number,
    extra: Partial<TimeEvidence> = {},
  ): TimeEvidence => ({
    id: `ev:${sourceId}:${kind}`,
    sourceId,
    kind,
    clock: kind === "manual" || kind === "spoken" ? "true" : "device",
    atMediaMs: 0,
    localMs: local,
    utcMs: null,
    uncertaintyMs: unc,
    detail: kind,
    raw: "",
    enabled: true,
    ...extra,
  });
  const evidence = [
    ev("ZOOM0004.m4a", "metadata", T(10, 15), 1000),
    ev("C0012.MP4", "metadata", T(10, 18, 47), 1000),
    ev("C0013.MP4", "metadata", T(10, 42, 57), 1000),
    ev("IMG_0231.jpg", "metadata", T(10, 12, 34), 1000),
    ev("IMG_0232.jpg", "metadata", T(10, 16, 49), 1000),
    ev("IMG_20260914_104050.jpg", "filename", T(10, 40, 50) + 500, 500),
  ];
  // Klatschen um 10:16:20: im Audio bei 80 s, im ersten Clip bei 20 s.
  const anchors: SyncAnchor[] = [
    {
      id: "clap1",
      sessionId: "s1",
      kind: "clap",
      a: { sourceId: "ZOOM0004.m4a", atMediaMs: 80_000 },
      b: { sourceId: "C0012.MP4", atMediaMs: 20_000 },
      uncertaintyMs: 50,
      note: "",
      enabled: true,
    },
  ];
  const diaryEntries: DiaryEntry[] = [
    {
      id: "d1",
      sessionId: "s1",
      regions: [{ sourceId: "Tagebuch_S01.jpg", x: 0, y: 0, w: 1, h: 1 }],
      notedAtMs: T(10, 12),
      lookbackMs: 7 * 60_000,
      mode: "scan",
      shortText: "",
      fullText: "",
    },
    {
      id: "d2",
      sessionId: "s1",
      regions: [{ sourceId: "Tagebuch_S02.jpg", x: 0, y: 0, w: 1, h: 1 }],
      notedAtMs: T(10, 25),
      lookbackMs: 8 * 60_000,
      mode: "short",
      shortText: "Käsestand",
      fullText: "",
    },
  ];
  return { session, devices, sources, evidence, anchors, diaryEntries };
}
