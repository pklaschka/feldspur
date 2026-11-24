/**
 * Episoden von Hand anpassen: Grenzen auf der Zeitachse ziehen, laute Stellen zur Mini-Episode machen.
 * Gespeichert wird je Aufnahme eine Strecke (ab Dateibeginn), nie eine Uhrzeit; so wandert die Anpassung mit,
 * wenn sich der Abgleich der Uhren später ändert. Ohne Electron, damit es sich direkt testen lässt.
 *
 * Gehört zum Schritt „Durchsehen“ (Zeitachse in `src/renderer/Review.tsx`), aufgerufen aus `ipc/review.ts` (Kanäle
 * `episodes:…`). Die Episoden selbst werden nicht gespeichert: `sessionEpisodes` in `packages/media` bildet sie aus
 * der Tonspur-Analyse und rechnet diese Anpassungen ein. Die Oberfläche spricht in Uhrzeiten (ms), hier wird
 * umgerechnet.
 */
import { resolveTimeline, type Id, type ProjectStore } from "@feldspur/core";

/** Halbe Länge einer Mini-Episode um eine laute Stelle. */
const MINI_EPISODE_HALF_MS = 15_000;

/** Aufnahmen mit Ton, die zwischen fromMs und toMs (Uhrzeit) laufen, mit ihrer Lage. */
function runningAv(store: ProjectStore, sessionId: Id, fromMs: number, toMs: number) {
  const input = store.loadResolveInput(sessionId);
  const res = resolveTimeline(input);
  return input.sources.flatMap((s) => {
    if (s.kind !== "audio" && s.kind !== "video") return [];
    const p = res.placements.get(s.id);
    if (!p || p.endMs <= fromMs || p.startMs >= toMs) return [];
    return [{ source: s, startMs: p.startMs, endMs: p.endMs }];
  });
}

/** Uhrzeit-Strecke als Anpassung an allen dort laufenden Aufnahmen speichern. Gibt die Anzahl zurück. */
function addEdit(store: ProjectStore, sessionId: Id, fromMs: number, toMs: number, mode: "include" | "exclude") {
  const a = Math.round(Math.min(fromMs, toMs));
  const b = Math.round(Math.max(fromMs, toMs));
  if (b - a < 500) return 0;
  const running = runningAv(store, sessionId, a, b);
  for (const r of running) {
    store.addEpisodeEdit({
      sourceId: r.source.id,
      fromMs: Math.max(0, a - r.startMs),
      toMs: Math.min(r.endMs, b) - r.startMs,
      mode,
    });
  }
  return running.length;
}

/**
 * Grenze verschieben. Wird eine Episode größer (Beginn früher, Ende später), kommt die Strecke dazu, sonst fällt sie
 * heraus. Liegt dort keine Aufnahme, lässt sich eine Episode nicht vergrößern: Episoden gibt es nur, wo etwas läuft.
 */
export function moveEpisodeEdge(
  store: ProjectStore,
  sessionId: Id,
  edge: "start" | "end",
  fromMs: number,
  toMs: number,
): void {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new Error("Ungültige Uhrzeit");
  const grow = edge === "start" ? toMs < fromMs : toMs > fromMs;
  const n = addEdit(store, sessionId, fromMs, toMs, grow ? "include" : "exclude");
  if (!n && grow) throw new Error("Dort läuft keine Aufnahme; eine Episode kann nur Strecken mit Aufnahme umfassen.");
}

/** Kurze Episode um eine Uhrzeit, aus allen dort laufenden Aufnahmen. */
export function addEpisodeAround(store: ProjectStore, sessionId: Id, atMs: number): void {
  if (!Number.isFinite(atMs)) throw new Error("Ungültige Uhrzeit");
  const n = addEdit(store, sessionId, atMs - MINI_EPISODE_HALF_MS, atMs + MINI_EPISODE_HALF_MS, "include");
  if (!n) throw new Error("An dieser Stelle läuft keine Aufnahme.");
}

/** Hüllkurven für die Zeitachse: aus 100 Werten je Sekunde vier (jeweils der lauteste). */
export function timelineEnvelopes(
  store: ProjectStore,
  sessionId: Id,
): Record<string, { rate: number; data: Uint8Array }> {
  const out: Record<string, { rate: number; data: Uint8Array }> = {};
  for (const a of store.listAudioAnalyses(sessionId)) {
    const step = Math.max(1, Math.round(a.envelopeRate / 4));
    const env = a.envelope;
    const data = new Uint8Array(Math.ceil(env.length / step));
    for (let i = 0; i < data.length; i++) {
      let m = 0;
      for (let j = i * step; j < Math.min(env.length, (i + 1) * step); j++) if (env[j]! > m) m = env[j]!;
      data[i] = m;
    }
    out[a.sourceId] = { rate: a.envelopeRate / step, data };
  }
  return out;
}
