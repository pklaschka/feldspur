import { describe, expect, it } from "vite-plus/test";
import { isScrollingList, openStatusCounts } from "../src/renderer/collectLayout.ts";

describe("Lange Dateilisten beim Einsammeln", () => {
  it.each`
    dateien | scrollt
    ${3}    | ${false}
    ${12}   | ${false}
    ${13}   | ${true}
    ${40}   | ${true}
  `("$dateien Dateien: Liste scrollt in der Karte: $scrollt", ({ dateien, scrollt }) => {
    expect(isScrollingList(dateien)).toBe(scrollt);
  });

  it("nennt in der Fußzeile zuerst Dateien ohne Zeit, dann zu prüfende, aber keine sicheren", () => {
    expect(openStatusCounts(["ok", "check", "unplaced", "check", "context", "ok"])).toEqual([
      { status: "unplaced", count: 1 },
      { status: "check", count: 2 },
    ]);
  });

  it("zeigt nichts, wenn alle Dateien sicher sind", () => {
    expect(openStatusCounts(["ok", "ok"])).toEqual([]);
  });
});
