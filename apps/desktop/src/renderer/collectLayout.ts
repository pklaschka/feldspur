/**
 * Lange Dateilisten im Schritt Einsammeln (Issue #166): Ein Gerät mit vielen Dateien zeigt seine Liste in fester
 * Höhe, die in der Karte scrollt. So bleiben alle Gerätekarten gleich breit und ungefähr gleich hoch, nichts springt
 * beim Durchsehen, und die Fußzeile nennt, wie viele Dateien noch zu prüfen sind oder keine Zeit haben.
 */

/** Ab so vielen Dateien scrollt die Liste in der Karte; darunter wächst die Karte einfach mit. */
export const SCROLL_FROM = 13;

export const isScrollingList = (total: number) => total >= SCROLL_FROM;

export type RowStatus = "ok" | "check" | "unplaced" | "context";

/** Hinweise in der Fußzeile, in dieser Reihenfolge: was noch Arbeit macht. „sicher“ und „Kontext“ nicht. */
export function openStatusCounts(statuses: RowStatus[]): { status: "unplaced" | "check"; count: number }[] {
  return (["unplaced", "check"] as const)
    .map((status) => ({ status, count: statuses.filter((s) => s === status).length }))
    .filter((c) => c.count > 0);
}
