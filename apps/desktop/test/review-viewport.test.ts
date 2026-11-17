import { describe, expect, it } from "vite-plus/test";
import {
  axisRange,
  fitPpm,
  MAX_PPM,
  maxScroll,
  revealPpm,
  scrollFor,
  wheelFactor,
  zoomAround,
} from "../src/renderer/review/viewport.ts";
import { buildTracks, rowStart, trackHeightFor, trackSub } from "../src/renderer/review/tracks.ts";
import type { DeviceRow, SourceRow } from "../src/shared/api.ts";

// Erfundenes Beispiel, keine Forschungsdaten.
const MIN = 60_000;
const at = (h: number, m: number) => Date.UTC(2026, 8, 14, h, m);
const row = (o: Partial<SourceRow> & { id: string }) =>
  ({
    startMs: null,
    endMs: null,
    diaryWindow: null,
    deviceId: null,
    partOf: null,
    ...o,
  }) as SourceRow;
const device = (o: Partial<DeviceRow> & { id: string }) =>
  ({ kind: "audio", isReference: false, personName: "", ...o }) as DeviceRow;

describe("axisRange", () => {
  it("nimmt Anfang und Ende aller Quellen, zwei Minuten Rand, auf fünf Minuten gerundet", () => {
    const r = axisRange([
      row({ id: "a", startMs: at(10, 3), endMs: at(10, 40) }),
      row({ id: "b", startMs: at(10, 20), endMs: at(11, 2) }),
    ]);
    expect(r).toEqual({ t0: at(10, 0), t1: at(11, 5) });
  });

  it("Tagebuchseiten ohne Startzeit zählen mit dem Ende ihres Bezugszeitraums", () => {
    const r = axisRange([
      row({ id: "a", startMs: at(10, 30), endMs: at(10, 40) }),
      row({ id: "d", diaryWindow: { fromMs: at(9, 0), toMs: at(11, 0) } as SourceRow["diaryWindow"] }),
    ]);
    expect(r).toEqual({ t0: at(10, 25), t1: at(11, 5) });
  });
});

describe("Zoom und Scrollen", () => {
  const axis = { t0: at(10, 0), t1: at(11, 0), width: 602 };

  it("Einpassen: eine Stunde auf 600 px sind 10 px/min, mindestens aber 0,2", () => {
    expect(fitPpm(602, axis.t0, axis.t1)).toBe(10);
    expect(fitPpm(10, at(0, 0), at(23, 0))).toBe(0.2);
  });

  it("weiteste Scrollposition ist Gesamtbreite minus Sichtbreite, nie negativ", () => {
    expect(maxScroll(axis.t0, axis.t1, 20, 602)).toBe(60 * 20 - 602);
    expect(maxScroll(axis.t0, axis.t1, 5, 602)).toBe(0);
  });

  it("scrollFor stellt die Zeit an die Bildschirmstelle und bleibt im Bereich", () => {
    expect(scrollFor(at(10, 30), 100, 20, axis)).toBe(30 * 20 - 100);
    expect(scrollFor(at(10, 1), 300, 20, axis)).toBe(0);
    expect(scrollFor(at(10, 59), 0, 20, axis)).toBe(60 * 20 - 602);
  });

  it("zoomAround hält die Zeit unter dem Mauszeiger fest", () => {
    const z = zoomAround(40, { t: at(10, 30), x: 200 }, axis);
    expect(z.ppm).toBe(40);
    expect(z.zoom).toBe(40);
    // Die Zeit steht danach wieder bei x = 200.
    expect(((at(10, 30) - axis.t0) / MIN) * z.ppm - z.scrollX).toBe(200);
  });

  it("zoomAround begrenzt auf Einpassen (dann zoom null) und MAX_PPM", () => {
    expect(zoomAround(1, { t: at(10, 30), x: 0 }, axis)).toEqual({ ppm: 10, zoom: null, scrollX: 0 });
    expect(zoomAround(10_000, { t: at(10, 30), x: 0 }, axis).ppm).toBe(MAX_PPM);
  });

  it("revealPpm füllt 80 % der Breite mit dem Bereich, innerhalb der Grenzen", () => {
    expect(revealPpm(at(10, 0), at(10, 10), { ...axis, width: 800 })).toBe(64);
    expect(revealPpm(at(10, 0), at(10, 0) + 1000, axis)).toBe(MAX_PPM);
    expect(revealPpm(at(10, 0), at(11, 0), axis)).toBe(10);
  });

  it("wheelFactor: Rad nach unten zoomt heraus, Strg zoomt stärker, Zeilen zählen 16 px", () => {
    expect(wheelFactor(100, 0, false, 600)).toBeLessThan(1);
    expect(wheelFactor(-100, 0, false, 600)).toBeGreaterThan(1);
    expect(wheelFactor(10, 0, true, 600)).toBeCloseTo(Math.exp(-0.1));
    expect(wheelFactor(1, 1, false, 600)).toBeCloseTo(wheelFactor(16, 0, false, 600));
  });
});

describe("Spuren", () => {
  it("Referenzuhr zuerst, dann nach Art; Quellen ohne Gerät in einer eigenen Spur am Ende", () => {
    const devices = [
      device({ id: "kam", kind: "video" }),
      device({ id: "foto", kind: "photo" }),
      device({ id: "ref", kind: "photo", isReference: true }),
    ];
    const placed = [row({ id: "v", deviceId: "kam" }), row({ id: "lose" })];
    const tracks = buildTracks(devices, placed);
    expect(tracks.map((t) => [t.device?.id ?? null, t.rows.map((r) => r.id)])).toEqual([
      ["ref", []],
      ["kam", ["v"]],
      ["foto", []],
      [null, ["lose"]],
    ]);
  });

  it("Spurhöhe teilt die freie Höhe, zwischen 52 und 88 px", () => {
    expect(trackHeightFor(300, 5)).toBe(60);
    expect(trackHeightFor(1000, 2)).toBe(88);
    expect(trackHeightFor(100, 4)).toBe(52);
    expect(trackHeightFor(70, 0)).toBe(70);
  });

  it("Untertitel: Referenzuhr, Person oder Anzahl, dazu was noch ohne Zeit ist", () => {
    const rows = [
      row({ id: "1", deviceId: "a", startMs: 1 }),
      row({ id: "2", deviceId: "a" }),
      row({ id: "2b", deviceId: "a", partOf: "2" }),
      row({ id: "3", deviceId: "b", startMs: 1 }),
    ];
    expect(trackSub({ device: device({ id: "a" }), rows: [] }, rows)).toBe("2 Dateien · 1 ohne Zeit");
    expect(trackSub({ device: device({ id: "b", personName: "Kim" }), rows: [] }, rows)).toBe("Kim");
    expect(trackSub({ device: device({ id: "b", isReference: true }), rows: [] }, rows)).toBe("Referenzuhr");
    expect(trackSub({ device: null, rows: [rows[0]!] }, rows)).toBe("1 Datei");
  });

  it("Startzeit: eigene Uhrzeit, sonst Ende des Tagebuch-Zeitraums, sonst 0", () => {
    expect(rowStart(row({ id: "a", startMs: 5 }))).toBe(5);
    expect(rowStart(row({ id: "d", diaryWindow: { fromMs: 1, toMs: 9 } as SourceRow["diaryWindow"] }))).toBe(9);
    expect(rowStart(row({ id: "x" }))).toBe(0);
  });
});
