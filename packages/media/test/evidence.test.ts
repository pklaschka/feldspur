import { formatLocal } from "@feldspur/core";
import { describe, expect, it } from "vite-plus/test";
import { classify, filenameFamily } from "../src/classify.ts";
import { evidenceFromExif, evidenceFromMediaTags, parseStamp } from "../src/evidence.ts";
import type { MediaProbe } from "../src/probe.ts";

const probe = (tags: Record<string, string>): MediaProbe => ({
  durationMs: 1000,
  hasAudio: true,
  hasVideo: true,
  tags,
  formatName: "mov",
});

describe("Zeitstempel lesen", () => {
  it("nimmt „Z“ als Ortszeit wie geschrieben und merkt sich UTC", () => {
    const s = parseStamp("2026-09-14T10:18:47.000000Z")!;
    expect(formatLocal(s.local)).toBe("2026-09-14T10:18:47");
    expect(s.utc).toBe(s.local);
  });
  it("versteht Zonen und EXIF-Doppelpunkte", () => {
    const s = parseStamp("2026-09-14T10:15:00+0200")!;
    expect(formatLocal(s.local)).toBe("2026-09-14T10:15:00");
    expect(new Date(s.utc!).toISOString()).toBe("2026-09-14T08:15:00.000Z");
    expect(formatLocal(parseStamp("2026:09:14 10:12:34")!.local)).toBe("2026-09-14T10:12:34");
  });
  it("verwirft Platzhalterdaten", () => {
    expect(parseStamp("1970-01-01T00:00:00Z")).toBeNull();
    expect(parseStamp("1904-01-01T00:00:00Z")).toBeNull();
    expect(parseStamp("unbekannt")).toBeNull();
  });
});

describe("Belege aus Metadaten", () => {
  it("Apple-Aufnahmedatum hat Vorrang vor creation_time", () => {
    const ev = evidenceFromMediaTags(
      probe({
        "com.apple.quicktime.creationdate": "2026-09-14T10:15:00+0200",
        creation_time: "2026-09-14T08:15:01.000000Z",
      }),
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]!.detail).toBe("Metadaten (Aufnahmebeginn, Apple)");
    expect(formatLocal(ev[0]!.localMs)).toBe("2026-09-14T10:15:00");
  });
  it("EXIF mit Sekundenbruchteilen", () => {
    const ev = evidenceFromExif({ dateTimeOriginal: "2026:09:14 10:12:34", subSec: "25" });
    expect(formatLocal(ev[0]!.localMs)).toBe("2026-09-14T10:12:34.250");
    expect(ev[0]!.uncertaintyMs).toBe(50);
  });
});

describe("Quellenart und Gerätefamilie", () => {
  it.each([
    ["C0012.MP4", "video"],
    ["ZOOM0004.WAV", "audio"],
    ["IMG_0231.jpg", "photo"],
    ["Tagebuch_S01.jpg", "diary"],
    ["Feldnotizen S. 3.pdf", "diary"],
    ["track.gpx", "gps"],
    ["notizen.md", "note"],
    ["readme.xyz", "other"],
  ])("%s → %s", (name, kind) => expect(classify(name)).toBe(kind));

  it("ein Foto mit Kamera-EXIF ist nie eine Tagebuchseite", () => {
    expect(classify("Scan_0001.jpg", { hasCameraExif: true })).toBe("photo");
  });

  it("Familie ersetzt Ziffern, aber nicht in der Endung", () => {
    expect(filenameFamily("/a/C0012.MP4")).toBe("C####.mp4");
    expect(filenameFamily("ZOOM0004.m4a")).toBe("ZOOM####.m4a");
  });
});
