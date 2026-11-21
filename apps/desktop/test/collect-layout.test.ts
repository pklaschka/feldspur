import { describe, expect, it } from "vite-plus/test";
import { isWideCard, splitByWidth, WIDE_CARD_FROM } from "../src/renderer/collectLayout.ts";

describe("Gerätekarten im Schritt Einsammeln", () => {
  it.each`
    dateien               | breit
    ${1}                  | ${false}
    ${WIDE_CARD_FROM - 1} | ${false}
    ${WIDE_CARD_FROM}     | ${true}
    ${400}                | ${true}
  `("ein Gerät mit $dateien Dateien nimmt die ganze Breite ein: $breit", ({ dateien, breit }) => {
    expect(isWideCard(dateien)).toBe(breit);
  });

  it("große Geräte stehen unter den kleinen, sonst bleibt die Reihenfolge", () => {
    // Angenommen: ein Handy mit vielen Fotos steht zwischen Tonaufnahme und Kamera
    const geraete = [
      { name: "Audiorekorder", dateien: 2 },
      { name: "Handy", dateien: 40 },
      { name: "Kamera", dateien: 3 },
      { name: "Zweithandy", dateien: 25 },
    ];

    // Wenn: die Karten angeordnet werden
    const { narrow, wide } = splitByWidth(geraete, (g) => g.dateien);

    // Dann: stehen die kleinen nebeneinander oben, die großen in ihrer Reihenfolge darunter
    expect(narrow.map((g) => g.name)).toEqual(["Audiorekorder", "Kamera"]);
    expect(wide.map((g) => g.name)).toEqual(["Handy", "Zweithandy"]);
  });
});
