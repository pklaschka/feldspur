/**
 * „Tabelle für den Methodenteil“ (Issue #149) in der App: die Tabellen selbst kommen aus `@feldspur/media`
 * (dieselben stehen in der LIESMICH der Ausgabe), hier kommt die Zeile zur Software dazu.
 *
 * Genutzt von der Übersicht (`apps/desktop/src/renderer/overview/`) und beim Ausgeben vom Hauptprozess
 * (`apps/desktop/src/main/ipc/export.ts`), der die Zeile an die LIESMICH weiterreicht.
 */
import { citationText, type CitationInput } from "./citation.ts";

export * from "@feldspur/media/methods-table";

/** Zeile unter den Tabellen: womit sie entstanden sind. */
export function softwareLine(c: CitationInput): string {
  return `Zusammengeführt und ausgegeben mit Feldspur, Version ${c.version}: ${citationText("apa", c)}`;
}
