/**
 * Aufbau des Montagebilds (`packages/media/src/layout.ts`): wo ein bis vier gleichzeitige Videos stehen, und wie der
 * Aufbau in jeder wählbaren Auflösung aussieht (Issue #250).
 */
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_FORMAT,
  FRAME_RATES,
  montageFormat,
  montageLayout,
  RESOLUTIONS,
  videoTiles,
  type MontageFormat,
} from "../src/layout.ts";

describe("Aufbau des Montagebilds", () => {
  it("ein Video füllt das Hauptfeld", () => {
    expect(videoTiles(1)).toEqual([montageLayout().main]);
  });

  it("zwei Videos stehen nebeneinander auf einer Höhe", () => {
    const two = videoTiles(2);
    expect(two).toHaveLength(2);
    expect(two[1]!.x).toBe(two[0]!.x + two[0]!.w);
    expect(two[0]!.y).toBe(two[1]!.y);
  });

  it("im Standardformat bleibt alles wie vor der Wahl der Auflösung: 1280 × 720, Leisten 52 und 36 Pixel", () => {
    const l = montageLayout(DEFAULT_FORMAT);
    expect([l.w, l.h, l.fps, l.u]).toEqual([1280, 720, 25, 1]);
    expect(l.top).toEqual({ x: 0, y: 0, w: 1280, h: 52 });
    expect(l.main).toEqual({ x: 0, y: 52, w: 1280, h: 632 });
    expect(l.bottom).toEqual({ x: 0, y: 684, w: 1280, h: 36 });
  });

  it.each`
    hoehe   | breite  | kopf  | fuss
    ${360}  | ${640}  | ${42} | ${28}
    ${540}  | ${960}  | ${42} | ${28}
    ${720}  | ${1280} | ${52} | ${36}
    ${1080} | ${1920} | ${78} | ${54}
  `(
    "$breite × $hoehe: Kopfzeile $kopf, Fußzeile $fuss Pixel, alles lückenlos und mit geraden Maßen",
    ({ hoehe, breite, kopf, fuss }: { hoehe: number; breite: number; kopf: number; fuss: number }) => {
      const l = montageLayout({ height: hoehe, fps: 25 });
      expect(l.w).toBe(breite);
      expect([l.top.h, l.bottom.h]).toEqual([kopf, fuss]);
      expect(l.top.h + l.main.h + l.bottom.h).toBe(hoehe);
      expect(l.main.y).toBe(l.top.h);
      expect(l.bottom.y).toBe(l.main.y + l.main.h);
      for (let n = 1; n <= 6; n++)
        for (const b of videoTiles(n, l)) {
          expect([b.x, b.y, b.w, b.h].every((v) => v % 2 === 0)).toBe(true);
          expect(b.x + b.w).toBeLessThanOrEqual(l.main.x + l.main.w);
          expect(b.y + b.h).toBeLessThanOrEqual(l.main.y + l.main.h);
        }
    },
  );

  it("unter 720 schrumpft die Schrift nicht so weit wie das Bild, damit Uhrzeit und Montage-ID lesbar bleiben", () => {
    expect(montageLayout({ height: 360, fps: 25 }).u).toBe(0.8);
    expect(montageLayout({ height: 540, fps: 25 }).u).toBe(0.8);
    expect(montageLayout({ height: 1080, fps: 25 }).u).toBe(1.5);
  });

  it("höchstens vier Videos, mit geraden Maßen und innerhalb des Hauptfelds", () => {
    const main = montageLayout().main;
    const four = videoTiles(6);
    expect(four).toHaveLength(4);
    for (const b of four) {
      expect(b.w % 2).toBe(0);
      expect(b.h % 2).toBe(0);
      expect(b.x + b.w).toBeLessThanOrEqual(main.x + main.w);
      expect(b.y + b.h).toBeLessThanOrEqual(main.y + main.h);
    }
  });
});

describe("Format aus der Projektdatei lesen", () => {
  it("jede wählbare Kombination bleibt, wie sie ist", () => {
    for (const height of RESOLUTIONS)
      for (const fps of FRAME_RATES) expect(montageFormat({ height, fps })).toEqual({ height, fps });
  });

  it.each`
    gespeichert                        | ergibt
    ${null}                            | ${{ height: 720, fps: 25 }}
    ${{ height: 480, fps: 25 }}        | ${{ height: 720, fps: 25 }}
    ${{ height: 360, fps: 24 }}        | ${{ height: 360, fps: 25 }}
    ${{ height: "1080", fps: 30 }}     | ${{ height: 720, fps: 30 }}
    ${{ height: 1080, fps: 30, x: 1 }} | ${{ height: 1080, fps: 30 }}
  `("$gespeichert ergibt $ergibt", ({ gespeichert, ergibt }: { gespeichert: unknown; ergibt: MontageFormat }) => {
    expect(montageFormat(gespeichert)).toEqual(ergibt);
  });
});
