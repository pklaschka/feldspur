/**
 * IPC-Aufrufe fürs Durchsehen und Mitschreiben: Episoden, Mitschrift, Notizen, Tagebuch und Kontext.
 *
 * Gegenstücke in der Oberfläche (`apps/desktop/src/renderer/`): Schritt „Durchsehen“ (`Review.tsx`, `review/`),
 * Mitschreiben (`Transcriber.tsx`, `Waveform.tsx`), Arbeitsnotizen (`Notes.tsx`), „Tagebuch abtippen“
 * (`DiaryEditor.tsx`, `PageNumbering.tsx`) und Kontext (`context/`). Die Regeln stehen in `../episodes.ts`,
 * `../transcript.ts`, `../notes.ts`, `../diary.ts` und `../context.ts`.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, ipcMain } from "electron";
import type { ProjectStore } from "@feldspur/core";
import { parseTranscript, readPeaks, TRANSCRIPT_EXTENSIONS } from "@feldspur/media";
import {
  IPC,
  type ContextDetails,
  type DiaryPatch,
  type PageNumberingInput,
  type Region,
  type TranscriptPatch,
  type SourceNoteInput,
} from "../../shared/api.ts";
import {
  contextFind,
  contextName,
  contextPosition,
  createContextText,
  moveContext,
  setContext,
  setContextDetails,
  setEntryRefs,
  sortContextByPage,
} from "../context.ts";
import { addRegion, createEntry, deleteEntry, moveRegion, patchEntry, removeRegion, setRegionPage } from "../diary.ts";
import { parseClockNear, sessionSpan, setPageNumbering } from "../edits.ts";
import { addNote, deleteNote, updateNote } from "../notes.ts";
import { addLine, deleteLine, importLines, updateLine } from "../transcript.ts";
import { addEpisodeAround, moveEpisodeEdge, timelineEnvelopes } from "../episodes.ts";
import { buildSessionView } from "../view.ts";
import { parentWindow, requireStore, stillOpen } from "../state.ts";
import { undoable, undoableView } from "./undoable.ts";

/**
 * Randnotiz einer Tagebuchseite: die Notierzeit ihres ersten Eintrags. Hat die Seite noch keinen, entsteht einer
 * über die ganze Seite (Rahmen ohne Maße). Leere Uhrzeit nimmt die Notierzeit zurück. Gibt die Einsatz-Id zurück.
 */
function setDiaryNote(s: ProjectStore, sourceId: string, clock: string): string {
  const src = s.getSource(sourceId);
  if (src.kind !== "diary") throw new Error("Keine Tagebuchseite");
  const session = s.getSession(src.sessionId);
  const entries = s.listDiaryEntries(session.id).filter((e) => e.regions.some((r) => r.sourceId === sourceId));
  const notedAtMs = clock.trim()
    ? parseClockNear(session.date, clock, sessionSpan(s, session.id), { seconds: false })
    : null;
  const first = entries[0];
  if (first) s.updateDiaryEntry(first.id, { notedAtMs });
  else if (notedAtMs !== null) s.addDiaryEntry({ sessionId: session.id, regions: [{ sourceId }], notedAtMs });
  return session.id;
}

export function registerReviewIpc(): void {
  // Episoden von Hand anpassen und Hüllkurven für die Zeitachse.
  undoableView(
    IPC.moveEpisodeEdge,
    "Episodengrenze verschoben",
    (s, id: string, edge: "start" | "end", from: number, to: number) => {
      moveEpisodeEdge(s, id, edge, from, to);
      return id;
    },
  );
  undoableView(IPC.addEpisodeAround, "Mini-Episode angelegt", (s, id: string, atMs: number) => {
    addEpisodeAround(s, id, atMs);
    return id;
  });
  undoableView(IPC.resetEpisodes, "Episoden zurückgesetzt", (s, id: string) => {
    s.clearEpisodeEdits(id);
    return id;
  });
  ipcMain.handle(IPC.envelopes, (_e, id: string) => timelineEnvelopes(requireStore(), id));

  // Mitschrift und Arbeitsnotizen.
  undoable(
    IPC.addTranscriptLine,
    "Zeile angelegt",
    (_e, sourceId: string, line: { atMs: number; speaker: string; text: string }) => {
      const s = requireStore();
      const l = addLine(s, sourceId, line);
      return { view: buildSessionView(s, s.getSource(sourceId).sessionId), lineId: l.id };
    },
  );
  undoableView(IPC.updateTranscriptLine, "Zeile geändert", (s, lineId: string, patch: TranscriptPatch) =>
    updateLine(s, lineId, patch),
  );
  undoableView(IPC.deleteTranscriptLine, "Zeile gelöscht", (s, lineId: string) => deleteLine(s, lineId));

  undoableView(IPC.addSourceNote, "Notiz angelegt", (s, sourceId: string, note: SourceNoteInput) =>
    addNote(s, sourceId, note),
  );
  undoableView(IPC.updateSourceNote, "Notiz geändert", (s, noteId: string, patch: SourceNoteInput) =>
    updateNote(s, noteId, patch),
  );
  undoableView(IPC.deleteSourceNote, "Notiz gelöscht", (s, noteId: string) => deleteNote(s, noteId));
  ipcMain.handle(IPC.waveformPeaks, (_e, sourceId: string, fromMs: number, toMs: number, buckets: number) => {
    const src = requireStore().getSource(sourceId);
    if (src.kind !== "audio" && src.kind !== "video") throw new Error(`${src.label} hat keine Tonspur`);
    return readPeaks(src.originalPath, fromMs, toMs, buckets);
  });

  ipcMain.handle(
    IPC.importTranscript,
    async (_e, sourceId: string, opts: { mode: "append" | "replace"; path?: string }) => {
      const s = requireStore();
      let path = opts.path;
      if (!path) {
        const r = await dialog.showOpenDialog(parentWindow(), {
          title: "Transkript importieren",
          properties: ["openFile"],
          filters: [{ name: "Transkript (Whisper u. a.)", extensions: TRANSCRIPT_EXTENSIONS }],
        });
        if (r.canceled || !r.filePaths[0]) return null;
        path = r.filePaths[0];
      }
      const lines = parseTranscript(await readFile(path, "utf8"), basename(path));
      stillOpen(s);
      // Nur der schreibende Teil ist ein Schritt für Rückgängig; Dateidialog und Parsen liegen davor.
      const label = opts.mode === "replace" ? "Mitschrift ersetzt" : "Transkript importiert";
      const r = s.history.record(label, () => importLines(s, sourceId, lines, opts.mode));
      return { view: buildSessionView(s, r.sessionId), count: r.count, dropped: r.dropped };
    },
  );

  // Tagebuch: Randnotiz, Einträge mit Rahmen, Seitenzählung.
  undoableView(IPC.setDiaryNote, "Randnotiz eingetragen", (s, sourceId: string, clock: string) =>
    setDiaryNote(s, sourceId, clock),
  );

  undoable(IPC.createDiaryEntry, "Tagebucheintrag angelegt", (_e, sourceId: string, region: Region) => {
    const s = requireStore();
    const r = createEntry(s, sourceId, region);
    return { view: buildSessionView(s, r.sessionId), entryId: r.entry.id };
  });
  undoableView(IPC.addDiaryRegion, "Rahmen ergänzt", (s, entryId: string, sourceId: string, region: Region) =>
    addRegion(s, entryId, sourceId, region),
  );
  undoableView(IPC.removeDiaryRegion, "Rahmen entfernt", (s, entryId: string, index: number) =>
    removeRegion(s, entryId, index),
  );
  undoableView(IPC.moveDiaryRegion, "Rahmen verschoben", (s, entryId: string, index: number, region: Region) =>
    moveRegion(s, entryId, index, region),
  );
  undoableView(
    IPC.setDiaryRegionPage,
    "Seitenzahl geändert",
    (s, entryId: string, index: number, pageNo: number | null) => setRegionPage(s, entryId, index, pageNo),
  );
  undoableView(IPC.deleteDiaryEntry, "Tagebucheintrag gelöscht", (s, entryId: string) => deleteEntry(s, entryId));
  undoableView(IPC.patchDiaryEntry, "Tagebucheintrag geändert", (s, entryId: string, patch: DiaryPatch) =>
    patchEntry(s, entryId, patch),
  );

  undoableView(IPC.setPageNumbering, "Seitenzählung geändert", (s, items: PageNumberingInput[]) =>
    setPageNumbering(s, items),
  );

  // Kontext (Issue #108): Beschriftungen nennen das Stück, damit das Änderungsprotokoll die Entscheidung belegt.
  undoableView(
    IPC.setContext,
    (s, key: string, on: boolean) =>
      `${on ? "Als Kontext geführt" : "Zurück in die Chronologie"}: ${contextFind(s, key)}`,
    (s, key: string, on: boolean) => setContext(s, key, on),
  );
  undoableView(
    IPC.setContextDetails,
    (s, key: string, _details: ContextDetails) => `Kontext geändert: ${contextName(s, key)}`,
    (s, key: string, details: ContextDetails) => setContextDetails(s, key, details),
  );
  undoableView(
    IPC.moveContext,
    (s, key: string, position: number) =>
      `Kontext umsortiert: ${contextName(s, key)} von Stelle ${contextPosition(s, key)} auf ${position}`,
    (s, key: string, position: number) => moveContext(s, key, position),
  );
  undoableView(IPC.sortContextByPage, "Kontext nach Seite geordnet", (s, sessionId: string) =>
    sortContextByPage(s, sessionId),
  );
  undoableView(
    IPC.setEntryRefs,
    (s, entryId: string, refs: string[]) => {
      const before = s.getDiaryEntry(entryId).contextRefs;
      const added = refs.filter((k) => !before.includes(k));
      const removed = before.filter((k) => !refs.includes(k));
      const name = (k: string) => {
        try {
          return contextName(s, k);
        } catch {
          return "?";
        }
      };
      if (added.length === 1 && !removed.length) return `Verweis gesetzt: → ${name(added[0]!)}`;
      if (removed.length === 1 && !added.length) return `Verweis entfernt: → ${name(removed[0]!)}`;
      return "Verweise geändert";
    },
    (s, entryId: string, refs: string[]) => setEntryRefs(s, entryId, refs),
  );
  undoable(
    IPC.createContextText,
    "Kontext als Text angelegt",
    (_e, sessionId: string, input: { title: string; text: string }) => {
      const s = requireStore();
      const id = createContextText(s, sessionId, input);
      return { view: buildSessionView(s, sessionId), key: `entry:${id}` };
    },
  );
}
