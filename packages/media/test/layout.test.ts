import { describe, expect, it } from "vite-plus/test";
import { LAYOUT, videoTiles } from "../src/layout.ts";

describe("Aufbau des Montagebilds", () => {
  it("teilt das Hauptfeld für gleichzeitige Videos", () => {
    expect(videoTiles(1)).toEqual([LAYOUT.main]);
    const two = videoTiles(2);
    expect(two).toHaveLength(2);
    expect(two[1]!.x).toBe(two[0]!.x + two[0]!.w);
    expect(two[0]!.y).toBe(two[1]!.y);
    const four = videoTiles(6);
    expect(four).toHaveLength(4);
    for (const b of four) {
      expect(b.w % 2).toBe(0);
      expect(b.h % 2).toBe(0);
      expect(b.x + b.w).toBeLessThanOrEqual(LAYOUT.main.x + LAYOUT.main.w);
      expect(b.y + b.h).toBeLessThanOrEqual(LAYOUT.main.y + LAYOUT.main.h);
    }
  });
});
