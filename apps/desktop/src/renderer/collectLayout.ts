/**
 * Lange Dateilisten im Schritt Einsammeln (Issue #166): Ein Gerät mit vielen Dateien zeigt zunächst nur die ersten
 * und darunter „Alle … zeigen“. So bleiben alle Gerätekarten gleich breit und ungefähr gleich hoch, und die Spalten
 * füllen sich gleichmäßig statt mit einer einzigen langen Karte.
 */

/** Ab so vielen Dateien wird gekürzt; darunter lohnt sich der Knopf nicht. */
export const SHORTEN_FROM = 13;
/** So viele Dateien zeigt eine gekürzte Karte. */
export const SHORT_COUNT = 8;

/**
 * Wie viele Einträge sichtbar sind. Eine ausgewählte Datei (etwa aus der Suche) bleibt nie verborgen: Dann geht die
 * Karte von selbst auf.
 */
export function visibleCount(total: number, expanded: boolean, selectedIndex: number): number {
  if (expanded || total < SHORTEN_FROM || selectedIndex >= SHORT_COUNT) return total;
  return SHORT_COUNT;
}
