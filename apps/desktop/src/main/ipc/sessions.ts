/**
 * IPC-Aufrufe zu Einsätzen (`FieldSession`): anlegen, ändern und löschen, Einsammeln, Quellen (`sources`) und Geräte
 * ordnen.
 *
 * Gegenstücke in der Oberfläche (`apps/desktop/src/renderer/`): Schritt „Einsammeln“ (`Collect.tsx`, `importState.ts`),
 * Einsatzdaten (`SessionDetails.tsx`), das Menü an einer Quelle (`SourceMenu.tsx`); fast alles läuft über
 * `app/SessionPane.tsx`. Die eigentliche Arbeit machen `scanPaths`/`applyImport` aus `packages/media` und
 * `../sources.ts`, `../session.ts`.
 */
import { basename } from "node:path";
import { dialog, ipcMain } from "electron";
import { applyImport, ScanCache, scanPaths, type ScanProgress } from "@feldspur/media";
import { IPC, type ImportResult, type NewSessionInput, type SessionPatch } from "../../shared/api.ts";
import { exportingSession } from "../export.ts";
import { updateSessionDetails } from "../session.ts";
import {
  linkFollowUps,
  mergeDevices,
  moveSource,
  removeSource,
  setFollows,
  setPartOf,
  setSourceKind,
} from "../sources.ts";
import { buildSessionView } from "../view.ts";
import { relinkDuplicates } from "../originals.ts";
import { analyzing, currentStore, importing, parentWindow, projectInfo, requireStore } from "../state.ts";
import { undoable, undoableView } from "./undoable.ts";

/** Schon vollständig gelesene Dateien: Ein zweiter Versuch nach einem Abbruch muss sie nicht erneut lesen. */
const scanCache = new ScanCache();

export function registerSessionsIpc(): void {
  undoable(IPC.createSession, "Einsatz angelegt", (_e, input: NewSessionInput) => {
    requireStore().addSession(input);
    return projectInfo();
  });

  ipcMain.handle(IPC.getSession, (_e, id: string) => buildSessionView(requireStore(), id));

  ipcMain.handle(IPC.pickFiles, async () => {
    const r = await dialog.showOpenDialog(parentWindow(), {
      title: "Quellen hinzufügen",
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle(IPC.cancelImport, (_e, sessionId: string) => {
    importing.get(sessionId)?.abort();
  });
  // Einsammeln in zwei Teilen: erst lesen (Prüfsumme, Metadaten; dauert und lässt sich abbrechen), dann in einem Zug
  // übernehmen. Bewusst kein `undoable`: Einsammeln ist kein Schritt für Rückgängig und leert den Verlauf
  // (`packages/core/src/db/history.ts`); im Änderungsprotokoll steht es als „Dateien eingesammelt“.
  ipcMain.handle(IPC.importPaths, async (e, sessionId: string, paths: string[]): Promise<ImportResult> => {
    const s = requireStore();
    if (importing.has(sessionId)) throw new Error("In diesen Einsatz wird schon eingesammelt.");
    const ctrl = new AbortController();
    importing.set(sessionId, ctrl);
    const skipped: { fileName: string; message: string }[] = [];
    let last: ScanProgress | null = null;
    let plan;
    try {
      plan = await scanPaths(paths, {
        signal: ctrl.signal,
        cache: scanCache,
        onSkipped: (path, message) => skipped.push({ fileName: basename(path), message }),
        onProgress: (p) => {
          last = p;
          if (!e.sender.isDestroyed()) e.sender.send(IPC.importProgress, { sessionId, ...p });
        },
      });
    } catch (err) {
      // Abgebrochen: Es wurde nichts ins Projekt geschrieben; Gelesenes merkt sich scanCache für den nächsten Versuch.
      if (ctrl.signal.aborted) {
        const p = last as ScanProgress | null;
        return { cancelled: { read: p?.phase === "reading" ? p.done : 0, total: p?.total ?? 0 } };
      }
      throw err;
    } finally {
      importing.delete(sessionId);
    }
    if (currentStore() !== s)
      throw new Error("Das Projekt wurde während des Einsammelns gewechselt. Nichts übernommen.");
    const res = applyImport(s, sessionId, plan);
    linkFollowUps(s, sessionId);
    // Wer verschobene Originale erneut einsammelt, verknüpft sie damit neu (gleiche Prüfsumme = gleiche Datei).
    const relinked = relinkDuplicates(
      s,
      res.duplicates.map((d) => ({ path: d.candidate.path, existing: d.existing })),
    );
    return {
      added: res.sources.length,
      duplicates: res.duplicates.length - relinked,
      relinked,
      warnings: [...skipped, ...plan.flatMap((c) => c.warnings.map((message) => ({ fileName: c.fileName, message })))],
      view: buildSessionView(s, sessionId),
    };
  });

  undoableView(
    IPC.renameDevice,
    "Gerät umbenannt",
    (s, deviceId: string, label: string) =>
      s.updateDevice(deviceId, { label: label.trim() || s.getDevice(deviceId).label }).sessionId,
  );

  undoable(IPC.updateSession, "Einsatzdaten geändert", (_e, sessionId: string, patch: SessionPatch) => {
    const s = requireStore();
    updateSessionDetails(s, sessionId, patch);
    return { view: buildSessionView(s, sessionId), project: projectInfo()! };
  });
  undoable(IPC.deleteSession, "Einsatz gelöscht", (_e, sessionId: string) => {
    const s = requireStore();
    if (importing.has(sessionId))
      throw new Error("In diesen Einsatz wird gerade eingesammelt. Bitte warten oder abbrechen, dann löschen.");
    if (exportingSession() === sessionId)
      throw new Error("Für diesen Einsatz läuft gerade eine Ausgabe. Bitte warten oder abbrechen, dann löschen.");
    if (analyzing.has(sessionId))
      throw new Error("Die Tonspuren dieses Einsatzes werden gerade analysiert. Bitte warten, dann löschen.");
    s.deleteSession(sessionId);
    return projectInfo()!;
  });
  // Quellen und Geräte ordnen (`../sources.ts`).
  undoableView(IPC.removeSource, "Quelle entfernt", (s, sourceId: string) => removeSource(s, sourceId));
  undoableView(IPC.moveSource, "Quelle verschoben", (s, sourceId: string, target: string | { newLabel: string }) =>
    moveSource(s, sourceId, target),
  );
  undoableView(IPC.mergeDevices, "Geräte zusammengeführt", (s, fromId: string, intoId: string) =>
    mergeDevices(s, fromId, intoId),
  );
  undoableView(IPC.setPartOf, "Seite zugeordnet", (s, sourceId: string, mainId: string | null) =>
    setPartOf(s, sourceId, mainId),
  );
  undoableView(IPC.setSourceKind, "Bildart geändert", (s, sourceId: string, kind: "diary" | "photo") =>
    setSourceKind(s, sourceId, kind),
  );
  undoableView(IPC.setFollows, "Folgeaufnahme gesetzt", (s, sourceId: string, prevId: string | null) =>
    setFollows(s, sourceId, prevId),
  );
}
