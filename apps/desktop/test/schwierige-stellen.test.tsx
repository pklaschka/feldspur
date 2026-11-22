// @vitest-environment happy-dom
/** Texte für schwierige Stellen (Issue #194): leere Suche und fehlende Originale. */
import { describe, expect, it } from "vite-plus/test";

(window as unknown as { feldspur: object }).feldspur = {};
const { nothingFound } = await import("../src/renderer/SearchDialog.tsx");
const { originalsDetail, originalsSummary } = await import("../src/renderer/Originals.tsx");

const rows = (missing: number, changed: number) => [
  ...Array.from({ length: missing }, () => ({ file: "missing" as const })),
  ...Array.from({ length: changed }, () => ({ file: "changed" as const })),
  { file: "ok" as const },
];

describe("Leere Suche", () => {
  it("nennt den Suchbegriff", () => {
    expect(nothingFound("  Glocke ")).toBe("Nichts gefunden für „Glocke“.");
  });
  it("kürzt einen langen Suchbegriff", () => {
    const text = nothingFound("a".repeat(80));
    expect(text).toMatch(/^Nichts gefunden für „a{39}…“\.$/);
  });
  it("sagt bei einer Uhrzeit, dass dort kein Eintrag liegt", () => {
    expect(nothingFound("10:15")).toBe("Um 10:15 Uhr liegt in diesem Einsatz kein Eintrag.");
  });
});

describe("Leiste für Originale", () => {
  it("spricht bei fehlenden Dateien von „findet nicht“ und beruhigt", () => {
    // Angenommen: zwei Originale sind nicht erreichbar
    // Dann: sagt die Leiste, dass Feldspur sie nicht findet und im Projekt nichts verloren ist
    expect(originalsSummary(rows(2, 0))).toBe("Feldspur findet 2 Originaldateien nicht.");
    expect(originalsSummary(rows(1, 0))).toBe("Feldspur findet 1 Originaldatei nicht.");
    expect(originalsDetail(rows(2, 0))).toMatch(/^Im Projekt ist nichts verloren: .*Festplatte nicht angeschlossen/);
  });
  it("spielt eine veränderte Datei nicht herunter", () => {
    // Angenommen: nur eine Datei ist verändert
    // Dann: sagt die Leiste das, ohne „nichts verloren“ zu versprechen
    expect(originalsSummary(rows(0, 1))).toBe("1 Originaldatei ist verändert.");
    expect(originalsDetail(rows(0, 1))).toMatch(/^Sie ist nicht mehr die Datei, die du eingesammelt hast/);
    expect(originalsDetail(rows(0, 1))).not.toMatch(/nichts verloren/);
    expect(originalsDetail(rows(0, 3))).toMatch(/Unveränderte Kopien lassen sich neu verknüpfen\.$/);
  });
  it("nennt beides, wenn Dateien fehlen und verändert sind", () => {
    expect(originalsSummary(rows(2, 1))).toBe("Feldspur findet 2 Originaldateien nicht, 1 ist verändert.");
    expect(originalsDetail(rows(2, 1))).toMatch(/Die veränderte Datei ist nicht mehr die vom Einsammeln\.$/);
    expect(originalsDetail(rows(2, 2))).toMatch(/Die veränderten Dateien sind nicht mehr die vom Einsammeln\.$/);
  });
  it("schweigt, wenn alles da ist", () => {
    expect(originalsSummary(rows(0, 0))).toBeNull();
    expect(originalsDetail(rows(0, 0))).toBeNull();
  });
});
