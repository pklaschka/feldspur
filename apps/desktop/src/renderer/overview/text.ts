/** Kurze Texte der Übersicht (`apps/desktop/src/renderer/Overview.tsx`): reine Hilfen ohne Oberfläche. */
import type { OverviewSession } from "../../shared/api.ts";
import { germanDate } from "../../shared/methods-table.ts";

/** „1 Einsatz“, „4 Einsätze“. */
export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** „4 Einsätze · 07.09.2026 bis 14.09.2026“. */
export function spanText(sessions: OverviewSession[]): string {
  const dates = sessions.map((s) => s.date).sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return "Noch kein Einsatz";
  const days = first === last ? germanDate(first) : `${germanDate(first)} bis ${germanDate(last)}`;
  return `${count(sessions.length, "Einsatz", "Einsätze")} · ${days}`;
}

/**
 * Was „Alle Einsätze ausgeben…“ je Einsatz schreibt, in einem Satz: immer Einsatztranskript, Dokumentvariablen und
 * Begleitprotokoll, dazu das, was im Schritt „Ausgeben“ gewählt ist.
 */
export function settingsText(o: {
  video: boolean;
  viewer: boolean;
  readme: boolean;
  roCrate: boolean;
  originals: boolean;
}): string {
  const extra = [
    o.video && "Montagevideo",
    o.video && o.viewer && "Viewer",
    o.readme && "LIESMICH",
    o.roCrate && "Metadaten (RO-Crate)",
    o.originals && "Kopien der Originale",
  ].filter((x): x is string => !!x);
  const list = extra.length > 1 ? `${extra.slice(0, -1).join(", ")} und ${extra.at(-1)}` : extra[0];
  return `Je Einsatz ein Ordner mit Einsatztranskript, Dokumentvariablen und Begleitprotokoll${list ? `, dazu ${list}` : ""}. Die Auswahl stammt aus dem Schritt „Ausgeben“.`;
}
