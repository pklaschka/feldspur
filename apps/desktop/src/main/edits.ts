/**
 * Änderungen, die Forschende von Hand machen: Uhrzeiten eintragen, angesagte
 * Uhrzeiten markieren, Belege abschalten, Anker setzen. Ohne Electron, damit
 * sich das direkt testen lässt.
 */
import { localMs, type Id, type ProjectStore } from "@feldspur/core";
import type { AnchorInput, TimeInput } from "../shared/api.ts";

/** ± je Genauigkeitsstufe. */
export const PRECISION_MS = { exact: 1_000, approx: 60_000, rough: 15 * 60_000 } as const;

/** "10:15", "10:15:30", "10.15" → Ortszeit am Tag des Einsatzes. */
export function parseClockOnDate(date: string, text: string): number {
  const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(text.trim());
  if (!m) throw new Error(`Uhrzeit bitte als hh:mm oder hh:mm:ss, nicht „${text}“`);
  const [h, mi, se] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || mi > 59 || se > 59) throw new Error(`„${text}“ ist keine gültige Uhrzeit`);
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return localMs(y, mo, d, h, mi, se);
}

/** Stelle in einer Aufnahme: "3:20", "1:03:20", "200" (Sekunden), leer = Anfang. */
export function parseMediaPos(text: string): number {
  const t = text.trim().replace(",", ".");
  if (!t) return 0;
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) throw new Error(`Stelle bitte als m:ss oder h:mm:ss, nicht „${text}“`);
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
  return Math.round(secs * 1000);
}

/** Uhrzeit von Hand oder angesagte Uhrzeit als Zeitbeleg anlegen. Gibt die Einsatz-Id zurück. */
export function addTimeEvidence(s: ProjectStore, input: TimeInput): Id {
  const src = s.getSource(input.sourceId);
  if (src.kind === "diary") throw new Error("Tagebuchseiten bekommen ihre Zeit über die Randnotiz");
  const session = s.getSession(src.sessionId);
  const at = parseMediaPos(input.atMedia);
  if (src.durationMs !== null && at > src.durationMs) throw new Error("Die Stelle liegt hinter dem Ende der Aufnahme");
  if (input.kind === "spoken" && src.kind !== "audio" && src.kind !== "video") {
    throw new Error("Angesagte Uhrzeiten gibt es nur in Audio und Video");
  }
  const local = parseClockOnDate(session.date, input.clock);
  const where = at ? ` bei ${input.atMedia.trim()}` : "";
  s.addEvidence({
    sourceId: src.id,
    kind: input.kind,
    clock: "true",
    atMediaMs: at,
    localMs: local,
    uncertaintyMs: PRECISION_MS[input.precision],
    detail: (input.kind === "spoken" ? `Angesagt${where}` : `Von Hand${where}`) + (input.note ? `: ${input.note}` : ""),
    raw: input.clock.trim(),
  });
  return session.id;
}

/** Nur selbst eingetragene Belege dürfen gelöscht werden; gelesene lassen sich nur abschalten. */
export function removeEvidence(s: ProjectStore, evidenceId: Id): Id {
  const ev = s.getEvidence(evidenceId);
  if (ev.kind !== "manual" && ev.kind !== "spoken") throw new Error("Gelesene Zeitbelege lassen sich nur abschalten");
  s.deleteEvidence(evidenceId);
  return s.getSource(ev.sourceId).sessionId;
}

export function toggleEvidence(s: ProjectStore, evidenceId: Id, enabled: boolean): Id {
  const ev = s.getEvidence(evidenceId);
  s.setEvidenceEnabled(evidenceId, enabled);
  return s.getSource(ev.sourceId).sessionId;
}

/** „Diese Stelle in A ist derselbe Moment wie diese Stelle in B.“ */
export function addManualAnchor(s: ProjectStore, input: AnchorInput): Id {
  if (input.aSourceId === input.bSourceId) throw new Error("Ein Anker verbindet zwei verschiedene Aufnahmen");
  const a = s.getSource(input.aSourceId);
  const b = s.getSource(input.bSourceId);
  if (a.sessionId !== b.sessionId) throw new Error("Beide Aufnahmen müssen zum selben Einsatz gehören");
  for (const [src, pos] of [
    [a, input.aAt],
    [b, input.bAt],
  ] as const) {
    if (src.kind === "diary") throw new Error("Tagebuchseiten bekommen ihre Zeit über die Randnotiz");
    const ms = parseMediaPos(pos);
    if (src.durationMs !== null && ms > src.durationMs)
      throw new Error(`Die Stelle liegt hinter dem Ende von ${src.label}`);
  }
  s.addAnchor({
    sessionId: a.sessionId,
    kind: "manual",
    a: { sourceId: a.id, atMediaMs: parseMediaPos(input.aAt) },
    b: { sourceId: b.id, atMediaMs: parseMediaPos(input.bAt) },
    uncertaintyMs: PRECISION_MS[input.precision],
    note: input.note.trim(),
  });
  return a.sessionId;
}
