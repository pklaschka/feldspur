import { describe, expect, it } from "vite-plus/test";
import { offsetText, parseOffset } from "../src/renderer/format.ts";

describe("Uhrabweichung eingeben", () => {
  it("Minuten und Sekunden wie bisher", () => {
    expect(parseOffset("−2:47")).toBe(-167_000);
    expect(parseOffset("+0:04")).toBe(4_000);
    expect(parseOffset("-167")).toBe(-167_000);
    expect(parseOffset("1,5")).toBe(1_500);
  });

  it("Stunden und Tage", () => {
    expect(parseOffset("+2:00:00")).toBe(7_200_000);
    expect(parseOffset("+1 Tag 2:00:00")).toBe(93_600_000);
    expect(parseOffset("−3 Tage")).toBe(-259_200_000);
    expect(parseOffset("+2 h 5 min")).toBe(7_500_000);
    expect(parseOffset("1d 0:00:30")).toBe(86_430_000);
  });

  it("lehnt Unsinn ab", () => {
    expect(parseOffset("")).toBeNull();
    expect(parseOffset("abc")).toBeNull();
    expect(parseOffset("3 Wochen")).toBeNull();
  });

  it("Anzeige und Eingabe passen zusammen", () => {
    for (const ms of [-167_000, 7_200_000, 93_600_000, -259_205_000]) expect(parseOffset(offsetText(ms))).toBe(ms);
  });
});
