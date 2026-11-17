import { useLoaded } from "../hooks.ts";
import type { SessionView } from "../../shared/api.ts";
import type { Envelope } from "../timeline.ts";

/**
 * Hüllkurven für die Wellenform in den Clips. Neu geholt, wenn sich die Analyse ändert (Anzahl analysierter
 * Tonspuren oder deren Leerlauf), nicht bei jeder anderen Änderung.
 */
export function useEnvelopes(view: SessionView): Map<string, Envelope> {
  const key = `${view.session.id}|${view.analyzedCount}|${view.rows.map((r) => `${r.id}:${r.idle.length}`).join(",")}`;
  const sessionId = view.session.id;
  // Beim Nachladen die bisherigen Hüllkurven stehen lassen, damit die Wellenform nicht kurz verschwindet.
  const loaded = useLoaded(
    view.analyzedCount ? key : null,
    async () => new Map(Object.entries(await window.feldspur.envelopes(sessionId))),
    { keep: true },
  );
  return (view.analyzedCount && loaded.value) || NO_ENVELOPES;
}
const NO_ENVELOPES = new Map<string, Envelope>();
