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

  it("formatiert Abweichungen wie im Konzept", () => {
    expect(formatDuration(-167_000)).toBe("−2:47");
    expect(formatDuration(4_000, { sign: true })).toBe("+0:04");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });

  it("rechnet UTC in Ortszeit um, auch über Sommerzeit", () => {
    const summerUtc = Date.UTC(2026, 8, 14, 8, 15);
    expect(formatLocal(utcToLocal(summerUtc, "Europe/Berlin"))).toBe("2026-09-14T10:15:00");
    const winterUtc = Date.UTC(2026, 11, 1, 9, 0);
    expect(formatLocal(utcToLocal(winterUtc, "Europe/Berlin"))).toBe("2026-12-01T10:00:00");
    expect(localToUtc(parseLocal("2026-09-14T10:15:00"), "Europe/Berlin")).toBe(summerUtc);
  });
});
