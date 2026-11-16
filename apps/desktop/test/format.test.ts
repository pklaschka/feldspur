import { describe, expect, it } from "vite-plus/test";
import { maskClock, normalizeClock, offsetText, parseOffset, stepClock } from "../src/renderer/format.ts";

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

describe("Uhrzeit als Maskenfeld", () => {
  it("setzt den Doppelpunkt beim Tippen selbst", () => {
    expect(maskClock("1")).toBe("1");
    expect(maskClock("10")).toBe("10");
    expect(maskClock("103")).toBe("10:3");
    expect(maskClock("1030")).toBe("10:30");
    expect(maskClock("10:30")).toBe("10:30");
    expect(maskClock("10:305")).toBe("10:30");
    expect(maskClock("10:")).toBe("10:");
    expect(maskClock("10.3")).toBe("10:3");
  });

  it("erkennt einstellige Stunden", () => {
    expect(maskClock("9")).toBe("09");
    expect(maskClock("93")).toBe("09:3");
    expect(maskClock("9:")).toBe("09:");
    expect(maskClock("9:15")).toBe("09:15");
  });

  it("ergänzt und prüft beim Verlassen", () => {
    expect(normalizeClock("")).toBe("");
    expect(normalizeClock("10")).toBe("10:00");
    expect(normalizeClock("930")).toBe("09:30");
    expect(normalizeClock("10:5")).toBe("10:05");
    expect(normalizeClock("10:30")).toBe("10:30");
    expect(normalizeClock("25:00")).toBeNull();
    expect(normalizeClock("10:75")).toBeNull();
    expect(normalizeClock("ab")).toBeNull();
  });

  it("Pfeiltasten verschieben um Minuten", () => {
    expect(stepClock("10:30", 1)).toBe("10:31");
    expect(stepClock("10:59", 1)).toBe("11:00");
    expect(stepClock("00:00", -1)).toBe("23:59");
    expect(stepClock("", 1)).toBe("");
  });
});
