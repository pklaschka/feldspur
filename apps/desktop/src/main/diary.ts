/**
 * Tagebuch abtippen: Einträge als Rahmen auf Scan-Seiten, mit Notierzeit,
 * Kurzform und Volltext. Ein Eintrag kann über mehrere Seiten laufen.
 *
 * Aufgerufen aus `ipc/review.ts` (Kanäle `diary:…`), bedient in `src/renderer/DiaryEditor.tsx`. Rahmen (`Region`)
 * sind relativ zur Seite gespeichert (0 … 1), damit sie von der Bildgröße unabhängig sind. Die Notierzeit eines
 * Eintrags bestimmt über den Bezugszeitraum, wo er in der Chronologie steht (`packages/core/src/resolve.ts`).
 */
import { contextKey, type DiaryEntry, type Id, type ProjectStore } from "@feldspur/core";
import type { DiaryPatch, Region } from "../shared/api.ts";
import { dropRefsTo } from "./context.ts";
import { parseClockNear, sessionSpan } from "./edits.ts";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Rahmen auf die Seite begrenzen (0 … 1, nicht über den Rand hinaus); ohne gültige PDF-Seite gilt Seite 0. */
function cleanRegion(r: Region): Required<Region> {
  const x = clamp01(r.x);
  const y = clamp01(r.y);
  const page = Number.isInteger(r.page) && r.page! >= 0 ? r.page! : 0;
  return { page, x, y, w: clamp01(Math.min(r.w, 1 - x)), h: clamp01(Math.min(r.h, 1 - y)) };
}

function requirePage(s: ProjectStore, sourceId: Id) {
  const src = s.getSource(sourceId);
  if (src.kind !== "diary") throw new Error("Rahmen gehen nur auf Tagebuchseiten");
  return src;
}

/**
 * Neuer Eintrag mit einem Rahmen auf einer Seite. Die Form (Kurzform oder Volltext) übernimmt er vom zuletzt
 * angelegten Eintrag des Einsatzes, der abgetippt wird; „Nur Scan“ wird nicht übernommen.
 */
export function createEntry(s: ProjectStore, sourceId: Id, region: Region): { sessionId: Id; entry: DiaryEntry } {
  const src = requirePage(s, sourceId);
  const r = cleanRegion(region);
  if (r.w < 0.01 || r.h < 0.01) throw new Error("Der Rahmen ist zu klein");
  // listDiaryEntries liefert in der Reihenfolge des Anlegens.
  const typed = s.listDiaryEntries(src.sessionId).filter((e) => e.mode !== "scan");
  const entry = s.addDiaryEntry({
    sessionId: src.sessionId,
    regions: [{ sourceId, ...r }],
    notedAtMs: null,
    mode: typed.at(-1)?.mode ?? "short",
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
  else deleteEntry(s, entryId);
  return e.sessionId;
}

/**
 * Rahmen verschieben oder in der Größe ändern. Seite, Quelle und Seitenzahl bleiben, nur die Lage auf dem Scan
 * ändert sich; so muss für eine kleine Korrektur kein neuer Eintrag her.
 */
export function moveRegion(s: ProjectStore, entryId: Id, index: number, region: Region): Id {
  const e = s.getDiaryEntry(entryId);
  const old = e.regions[index];
  if (!old) throw new Error("Rahmen nicht gefunden");
  const { page: _page, ...box } = cleanRegion({ ...region, page: old.page ?? 0 });
  if (box.w < 0.01 || box.h < 0.01) throw new Error("Der Rahmen ist zu klein");
  s.updateDiaryEntry(entryId, { regions: e.regions.map((r, i) => (i === index ? { ...r, ...box } : r)) });
  return e.sessionId;
}

/** Seitenzahl im Notizbuch an einem Rahmen eintragen; null = wieder aus der Zählung des Scans. */
export function setRegionPage(s: ProjectStore, entryId: Id, index: number, pageNo: number | null): Id {
  const e = s.getDiaryEntry(entryId);
  if (!e.regions[index]) throw new Error("Rahmen nicht gefunden");
  if (pageNo !== null && (!Number.isInteger(pageNo) || pageNo < 0 || pageNo > 99_999))
    throw new Error("Seitenzahl bitte als ganze Zahl ab 0");
  const regions = e.regions.map((r, i) => {
    if (i !== index) return r;
    const { pageNo: _old, ...rest } = r;
    return pageNo === null ? rest : { ...rest, pageNo };
  });
  s.updateDiaryEntry(entryId, { regions });
  return e.sessionId;
}

/** Eintrag löschen, samt der Verweise anderer Einträge auf ihn als Kontextstück. Gibt die Einsatz-Id zurück. */
export function deleteEntry(s: ProjectStore, entryId: Id): Id {
  const e = s.getDiaryEntry(entryId);
  s.transaction(() => {
    s.deleteDiaryEntry(entryId);
    dropRefsTo(s, e.sessionId, [contextKey.entry(entryId)]);
  });
  return e.sessionId;
}

/**
 * Notierzeit, Bezugszeitraum, Titel, Form und Text eines Eintrags ändern; nur gesetzte Felder. Die Notierzeit kommt
 * als Uhrzeit ohne Datum und wird dem passenden Tag zugeordnet (`parseClockNear`). Gibt die Einsatz-Id zurück.
 */
export function patchEntry(s: ProjectStore, entryId: Id, patch: DiaryPatch): Id {
  const e = s.getDiaryEntry(entryId);
  const session = s.getSession(e.sessionId);
  const next: Partial<DiaryEntry> = {};
  if (patch.notedAt !== undefined) {
    next.notedAtMs = patch.notedAt.trim()
      ? parseClockNear(session.date, patch.notedAt, sessionSpan(s, session.id))
      : null;
  }
  if (patch.lookbackMin !== undefined) {
    if (patch.lookbackMin !== null && (patch.lookbackMin < 0 || patch.lookbackMin > 24 * 60)) {
      throw new Error("Bezugszeitraum bitte zwischen 0 und 1440 Minuten");
    }
    next.lookbackMs = patch.lookbackMin === null ? null : Math.round(patch.lookbackMin * 60_000);
  }
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.mode !== undefined) next.mode = patch.mode;
  if (patch.shortText !== undefined) next.shortText = patch.shortText;
  if (patch.fullText !== undefined) next.fullText = patch.fullText;
  s.updateDiaryEntry(entryId, next);
  return e.sessionId;
}
