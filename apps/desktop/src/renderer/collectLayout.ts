// Anordnung der Gerätekarten im Schritt Einsammeln.

/** Ab so vielen Dateien wäre eine Gerätekarte in einer Spalte viel höher als die anderen. */
export const WIDE_CARD_FROM = 13;

/**
 * Große Geräte (etwa ein Handy mit vielen Fotos) nehmen die ganze Breite ein und verteilen ihre Dateien auf mehrere
 * Spalten. Sonst wächst die Ansicht auf großen Bildschirmen in einer Spalte in die Höhe, und daneben bleibt alles
 * leer (Issue #166).
 */
export function isWideCard(fileCount: number): boolean {
  return fileCount >= WIDE_CARD_FROM;
}

/** Teilt die Geräte in schmale und breite Karten; innerhalb beider Gruppen bleibt die Reihenfolge. */
export function splitByWidth<T>(items: readonly T[], fileCount: (item: T) => number): { narrow: T[]; wide: T[] } {
  return {
    narrow: items.filter((i) => !isWideCard(fileCount(i))),
    wide: items.filter((i) => isWideCard(fileCount(i))),
  };
}
