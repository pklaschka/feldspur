import { describe, expect, it } from "vite-plus/test";
import { COMPRESSOR, effectiveGainDb, LEVEL_TARGET_DB, levelActive, speechLevelDb } from "../src/level.ts";

const setting = (patch: Partial<Parameters<typeof effectiveGainDb>[0]> = {}) => ({
  levelMode: "auto" as const,
  levelGainDb: 0,
  levelCompress: true,
  ...patch,
});

describe("Sprachpegel", () => {
  it("misst das Gesprochene, lange Pausen ändern ihn kaum", () => {
    const talk = Array.from({ length: 1000 }, () => -30);
    const pause = Array.from({ length: 9000 }, () => -75);
    expect(speechLevelDb(talk)).toBeCloseTo(-30, 1);
    expect(speechLevelDb([...talk, ...pause])).toBeCloseTo(-30, 1);
  });

  it("lässt leises Rauschen neben lauter Sprache heraus", () => {
    const db = [...Array.from({ length: 500 }, () => -20), ...Array.from({ length: 5000 }, () => -50)];
    expect(speechLevelDb(db)).toBeCloseTo(-20, 1);
  });

  it("gibt null für Stille", () => {
    expect(speechLevelDb(Array.from({ length: 100 }, () => -100))).toBeNull();
  });
});

describe("Verstärkung", () => {
  it("gleicht automatisch auf den Zielpegel an, mit Grenzen", () => {
    expect(effectiveGainDb(setting(), -38)).toBe(LEVEL_TARGET_DB + 38);
    expect(effectiveGainDb(setting(), -8)).toBe(-12);
    expect(effectiveGainDb(setting(), -80)).toBe(30);
    expect(effectiveGainDb(setting(), null)).toBe(0);
  });

  it("von Hand und aus", () => {
    expect(effectiveGainDb(setting({ levelMode: "manual", levelGainDb: 7.5 }), -60)).toBe(7.5);
    expect(effectiveGainDb(setting({ levelMode: "manual", levelGainDb: 99 }), null)).toBe(40);
    expect(effectiveGainDb(setting({ levelMode: "off" }), -60)).toBe(0);
    expect(levelActive(setting({ levelMode: "off" }), 0)).toBe(false);
    expect(levelActive(setting({ levelCompress: false }), 0)).toBe(false);
    expect(levelActive(setting(), 0)).toBe(true);
  });

  it("Aufholverstärkung wie in Web Audio: (1 / Verstärkung bei 0 dBFS)^0,6", () => {
    const at0 = COMPRESSOR.thresholdDb - COMPRESSOR.thresholdDb / COMPRESSOR.ratio;
    expect(COMPRESSOR.makeupDb).toBeCloseTo(-0.6 * at0, 1);
  });
});
