/**
 * „Tabelle für den Methodenteil“ (Issue #149) in der App: die Tabellen selbst kommen aus `@feldspur/media`
 * (dieselben stehen in der LIESMICH der Ausgabe), hier kommt die Zeile zur Software dazu.
 */
import { citationText, type CitationInput } from "./citation.ts";

export * from "@feldspur/media/methods-table";

/** Zeile unter den Tabellen: womit sie entstanden sind. */
export function softwareLine(c: CitationInput): string {
  return `Zusammengeführt und ausgegeben mit Feldspur, Version ${c.version}: ${citationText("apa", c)}`;
}
