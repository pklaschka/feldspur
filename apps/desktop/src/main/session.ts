/** Einsatzdaten nachträglich bearbeiten. */
import type { ProjectStore, TimeEvidence } from "@feldspur/core";
import type { SessionPatch } from "../shared/api.ts";

const DAY = 86_400_000;

/**
 * Hängt die Zeit dieses Belegs am Einsatzdatum? Von Hand gesetzte und angesagte Uhrzeiten ja; eine Prüfung nur,
 * wenn sie einer solchen folgte. Eine geprüfte Lage aus Metadaten oder Dateiname bleibt auf dem Tag der Datei.
 */
function followsSessionDate(e: TimeEvidence): boolean {
  if (e.kind === "manual" || e.kind === "spoken") return true;
  const basis = e.kind === "checked" ? e.decision?.basisKind : undefined;
  return basis === "manual" || basis === "spoken";
}

/**
 * Titel, Datum, Ort, Zeitzone, Standard-Bezugszeitraum, Episoden und Zusatzfelder ändern.
 * Wird das Datum verschoben, wandern alle von Hand eingetragenen Uhrzeiten (Zeitbelege von Hand,
 * angesagte Zeiten, Notierzeiten im Tagebuch) mit, weil sie als Uhrzeit an diesem Tag gemeint waren.
 * Zeiten aus Metadaten und Dateinamen bleiben, wie sie sind, auch wenn ihre Lage geprüft wurde.
 */
export function updateSessionDetails(s: ProjectStore, sessionId: string, patch: SessionPatch): void {
  const before = s.getSession(sessionId);
  const next: Partial<typeof before> = {};
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new Error("Der Titel darf nicht leer sein");
    next.title = patch.title.trim();
  }
  if (patch.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date) || Number.isNaN(Date.parse(patch.date))) {
      throw new Error(`Datum bitte als JJJJ-MM-TT, nicht „${patch.date}“`);
    }
    next.date = patch.date;
  }
  if (patch.place !== undefined) next.place = patch.place.trim();
  if (patch.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat("de", { timeZone: patch.timeZone });
    } catch {
      throw new Error(`Unbekannte Zeitzone „${patch.timeZone}“`);
    }
    next.timeZone = patch.timeZone;
  }
  if (patch.diaryLookbackMin !== undefined) {
    const m = patch.diaryLookbackMin;
    if (!Number.isFinite(m) || m < 0 || m > 1440) throw new Error("Bezugszeitraum bitte zwischen 0 und 1440 Minuten");
    next.diaryLookbackMs = Math.round(m * 60_000);
  }
  if (patch.episodes !== undefined) next.episodes = patch.episodes;
  if (patch.extra !== undefined) {
    next.extra = Object.fromEntries(
      Object.entries(patch.extra)
        .map(([k, v]) => [k.trim(), v.trim()] as const)
        .filter(([k]) => k),
    );
  }
  const shift = next.date ? Math.round((Date.parse(next.date) - Date.parse(before.date)) / DAY) * DAY : 0;
  s.transaction(() => {
    s.updateSession(sessionId, next);
    if (!shift) return;
    for (const e of s.listEvidence(sessionId)) {
      if (!followsSessionDate(e)) continue;
      s.updateEvidenceTime(e.id, e.localMs + shift);
    }
    for (const d of s.listDiaryEntries(sessionId)) {
      if (d.notedAtMs !== null) s.updateDiaryEntry(d.id, { notedAtMs: d.notedAtMs + shift });
    }
  });
}
