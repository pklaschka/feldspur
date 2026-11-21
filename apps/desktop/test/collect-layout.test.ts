import { describe, expect, it } from "vite-plus/test";
import { SHORT_COUNT, visibleCount } from "../src/renderer/collectLayout.ts";

describe("Lange Dateilisten beim Einsammeln", () => {
  it.each`
    dateien | aufgeklappt | ausgewählt | sichtbar
    ${3}    | ${false}    | ${-1}      | ${3}
    ${12}   | ${false}    | ${-1}      | ${12}
    ${13}   | ${false}    | ${-1}      | ${SHORT_COUNT}
    ${40}   | ${false}    | ${2}       | ${SHORT_COUNT}
    ${40}   | ${true}     | ${-1}      | ${40}
    ${40}   | ${false}    | ${30}      | ${40}
  `(
    "$dateien Dateien, aufgeklappt $aufgeklappt, Auswahl an Stelle $ausgewählt: $sichtbar sichtbar",
    ({ dateien, aufgeklappt, ausgewählt, sichtbar }) => {
      expect(visibleCount(dateien, aufgeklappt, ausgewählt)).toBe(sichtbar);
    },
  );
});
