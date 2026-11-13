/**
 * Tagebuch abtippen: Einträge als Rahmen auf Scan-Seiten, mit Notierzeit,
 * Kurzform und Volltext. Ein Eintrag kann über mehrere Seiten laufen.
 */
import type { DiaryEntry, Id, ProjectStore } from "@feldspur/core";
import type { DiaryPatch, Region } from "../shared/api.ts";
import { parseClockOnDate } from "./edits.ts";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function cleanRegion(r: Region): Region {
  const x = clamp01(r.x);
  const y = clamp01(r.y);
  return { x, y, w: clamp01(Math.min(r.w, 1 - x)), h: clamp01(Math.min(r.h, 1 - y)) };
}

function requirePage(s: ProjectStore, sourceId: Id) {
  const src = s.getSource(sourceId);
  if (src.kind !== "diary") throw new Error("Rahmen gehen nur auf Tagebuchseiten");
  return src;
}

/** Neuer Eintrag mit einem Rahmen auf einer Seite. */
export function createEntry(s: ProjectStore, sourceId: Id, region: Region): { sessionId: Id; entry: DiaryEntry } {
  const src = requirePage(s, sourceId);
  const r = cleanRegion(region);
  if (r.w < 0.01 || r.h < 0.01) throw new Error("Der Rahmen ist zu klein");
  const entry = s.addDiaryEntry({
    sessionId: src.sessionId,
    regions: [{ sourceId, ...r }],
    notedAtMs: null,
    mode: "short",
  });
  return { sessionId: src.sessionId, entry };
}

/** Eintrag auf einer weiteren Seite fortsetzen (oder einen weiteren Rahmen anfügen). */
export function addRegion(s: ProjectStore, entryId: Id, sourceId: Id, region: Region): Id {
  const src = requirePage(s, sourceId);
  const e = s.getDiaryEntry(entryId);
  if (e.sessionId !== src.sessionId) throw new Error("Seite gehört zu einem anderen Einsatz");
  s.updateDiaryEntry(entryId, { regions: [...e.regions, { sourceId, ...cleanRegion(region) }] });
  return e.sessionId;
}

/** Rahmen entfernen; ohne Rahmen verschwindet der Eintrag. */
export function removeRegion(s: ProjectStore, entryId: Id, index: number): Id {
  const e = s.getDiaryEntry(entryId);
  const regions = e.regions.filter((_, i) => i !== index);
  if (regions.length) s.updateDiaryEntry(entryId, { regions });
  else s.deleteDiaryEntry(entryId);
  return e.sessionId;
}

export function deleteEntry(s: ProjectStore, entryId: Id): Id {
  const e = s.getDiaryEntry(entryId);
  s.deleteDiaryEntry(entryId);
  return e.sessionId;
}

export function patchEntry(s: ProjectStore, entryId: Id, patch: DiaryPatch): Id {
  const e = s.getDiaryEntry(entryId);
  const session = s.getSession(e.sessionId);
  const next: Partial<DiaryEntry> = {};
  if (patch.notedAt !== undefined) {
    next.notedAtMs = patch.notedAt.trim() ? parseClockOnDate(session.date, patch.notedAt) : null;
  }
  if (patch.lookbackMin !== undefined) {
    if (patch.lookbackMin !== null && (patch.lookbackMin < 0 || patch.lookbackMin > 24 * 60)) {
      throw new Error("Bezugszeitraum bitte zwischen 0 und 1440 Minuten");
    }
    next.lookbackMs = patch.lookbackMin === null ? null : Math.round(patch.lookbackMin * 60_000);
  }
  if (patch.mode !== undefined) next.mode = patch.mode;
  if (patch.shortText !== undefined) next.shortText = patch.shortText;
  if (patch.fullText !== undefined) next.fullText = patch.fullText;
  s.updateDiaryEntry(entryId, next);
  return e.sessionId;
}
