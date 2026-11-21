import { describe, expect, it } from "vite-plus/test";
import { formatClock, formatDuration, formatLocal, localMs, localToUtc, parseLocal, utcToLocal } from "../src/time.ts";

describe("Ortszeit", () => {
  it("liest und schreibt Ortszeiten verlustfrei", () => {
    const t = parseLocal("2026-09-14T10:15:00");
    expect(t).toBe(localMs(2026, 9, 14, 10, 15));
    expect(formatLocal(t)).toBe("2026-09-14T10:15:00");
    expect(formatLocal(parseLocal("2026-09-14 10:15:00.25"))).toBe("2026-09-14T10:15:00.250");
    expect(formatClock(t)).toBe("10:15:00");
  });

  it("lehnt unmögliche Daten ab", () => {
    expect(() => parseLocal("2026-02-30T10:00:00")).toThrow(/Ungültig/);
    expect(() => parseLocal("gestern")).toThrow();
  });

  it.each`
    ms                         | vorzeichen | text
    ${-167_000}                | ${false}   | ${"−2:47"}
    ${4_000}                   | ${true}    | ${"+0:04"}
    ${3_723_000}               | ${false}   | ${"1:02:03"}
    ${86_400_000 + 7_200_000}  | ${true}    | ${"+1 Tag 2:00:00"}
    ${-3 * 86_400_000 - 5_000} | ${false}   | ${"−3 Tage 0:00:05"}
  `("Abweichung $ms ms steht als $text", ({ ms, vorzeichen, text }) => {
    expect(formatDuration(ms, { sign: vorzeichen })).toBe(text);
  });

  it.each`
    utc                             | ortszeit                 | jahreszeit
    ${Date.UTC(2026, 8, 14, 8, 15)} | ${"2026-09-14T10:15:00"} | ${"Sommerzeit"}
    ${Date.UTC(2026, 11, 1, 9, 0)}  | ${"2026-12-01T10:00:00"} | ${"Winterzeit"}
  `("rechnet UTC in Berliner Ortszeit um ($jahreszeit) und zurück", ({ utc, ortszeit }) => {
    expect(formatLocal(utcToLocal(utc, "Europe/Berlin"))).toBe(ortszeit);
    expect(localToUtc(parseLocal(ortszeit), "Europe/Berlin")).toBe(utc);
  });
});
