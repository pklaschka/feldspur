/**
 * IPC-Aufrufe fürs Ausgeben: Vorschau, Stand, Ausgabe, Originale prüfen und wiederfinden.
 *
 * Gegenstücke in der Oberfläche (`apps/desktop/src/renderer/`): Schritt „Ausgeben“ (`ExportStep.tsx`,
 * `exportState.tsx`, `export/`), die Vorschau der Montage (`MontageView.tsx`) und die Prüfung der Originale
 * (`Originals.tsx`). Die Ausgabe ist kein Schritt für Rückgängig: Sie ändert keine Forschungsdaten, nur den Vermerk
 * über die letzte Ausgabe. Neu verknüpfte Originale tragen sich dagegen selbst in den Verlauf ein
 * (`../originals.ts`). Die Arbeit der Ausgabe steckt in `../export.ts`.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { dialog, ipcMain, shell } from "electron";
import { IPC, type ExportRequest } from "../../shared/api.ts";
import {
  cancelExport,
  exportCard,
  exportStatus,
  montagePlan,
  previewExport,
  registerOverlayBridge,
  runExport,
} from "../export.ts";
import { setProjectFormat } from "../montage-format.ts";
import { undoableView } from "./undoable.ts";
import { verifyFolder, type MontageFormat } from "@feldspur/media";
import { buildSessionView } from "../view.ts";
import { checkOriginals, relinkFile, searchOriginals } from "../originals.ts";
import { citationInfo } from "../citation.ts";
import { softwareLine } from "../../shared/methods-table.ts";
import { ALL_VERSIONS_DOI } from "../../shared/citation.ts";
import { parentWindow, requireStore, stillOpen, whileOpen } from "../state.ts";

export function registerExportIpc(): void {
  registerOverlayBridge();

  ipcMain.handle(IPC.previewExport, (_e, sessionId: string, realtime?: boolean) =>
    previewExport(requireStore(), sessionId, realtime),
  );
  ipcMain.handle(IPC.exportStatus, (_e, sessionId: string, opts: ExportRequest) =>
    exportStatus(requireStore(), sessionId, opts),
  );
  ipcMain.handle(IPC.exportCard, (_e, sessionId: string, opts: ExportRequest) =>
    exportCard(requireStore(), sessionId, opts),
  );
  ipcMain.handle(IPC.openExportFile, async (_e, sessionId: string, name: string) => {
    // Nur Dateien, die zu dieser Ausgabe gehören: Der Name kommt aus dem Ausgabe-Vermerk, nie ein freier Pfad.
    const record = requireStore().getExportRecord(sessionId);
    if (!record?.files.includes(String(name))) return false;
    const path = join(record.dir, String(name));
    if (!existsSync(path)) return false;
    return (await shell.openPath(path)) === "";
  });
  ipcMain.handle(IPC.montagePreview, (_e, sessionId: string, realtime?: boolean) =>
    montagePlan(requireStore(), sessionId, realtime),
  );
  // Auflösung und Bildrate gelten fürs ganze Projekt und stehen in der Projektdatei: ein Schritt für Rückgängig.
  undoableView(IPC.setMontageFormat, "Videoeinstellungen geändert", (s, sessionId: string, format: MontageFormat) => {
    setProjectFormat(s, format);
    return sessionId;
  });
  ipcMain.handle(IPC.exportSession, async (e, sessionId: string, opts: ExportRequest) => {
    const s = requireStore();
    let parent = opts.dir;
    // Der Ordner der letzten Ausgabe (darin liegt der Unterordner des Einsatzes) dient als Vorgabe.
    const lastDir = s.getExportRecord(sessionId)?.dir;
    const lastParent = lastDir && existsSync(dirname(lastDir)) ? dirname(lastDir) : undefined;
    if (!parent && opts.reuseDir) parent = lastParent;
    if (!parent) {
      const r = await dialog.showOpenDialog(parentWindow(), {
        title: "Wohin ausgeben?",
        buttonLabel: "Hier ausgeben",
        defaultPath: lastParent,
        properties: ["openDirectory", "createDirectory"],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      parent = r.filePaths[0];
      stillOpen(s);
    }
    // Zeile zur Software für die LIESMICH: Version und DOI wie in „Feldspur zitieren“, ohne Abfrage im Netz.
    const c = citationInfo();
    const software = softwareLine({
      version: c.version,
      released: c.released,
      doi: c.versionDoi?.doi ?? ALL_VERSIONS_DOI,
    });
    const doi = c.versionDoi?.doi ?? ALL_VERSIONS_DOI;
    return runExport(s, e.sender, sessionId, parent, {
      ...opts,
      software,
      softwareRef: { version: c.version, url: `https://doi.org/${doi}` },
    });
  });
  ipcMain.handle(IPC.cancelExport, (_e, sessionId: string) => cancelExport(sessionId));
  // „Ordner prüfen…“ (Issue #208): braucht kein offenes Projekt, liest nur.
  let folderCheck: AbortController | null = null;
  ipcMain.handle(IPC.checkFolder, async (e, dir?: string) => {
    const r = await dialog.showOpenDialog(parentWindow(), {
      title: "Ausgabeordner prüfen",
      buttonLabel: "Diesen Ordner prüfen",
      defaultPath: typeof dir === "string" && existsSync(dir) ? dir : undefined,
      properties: ["openDirectory"],
    });
    const chosen = r.filePaths[0];
    if (r.canceled || !chosen) return null;
    folderCheck?.abort();
    const ctrl = new AbortController();
    folderCheck = ctrl;
    let last = 0;
    try {
      return await verifyFolder(chosen, {
        signal: ctrl.signal,
        onProgress: (done, total) => {
          const now = Date.now();
          if (done !== 0 && done !== total && now - last < 100) return;
          last = now;
          if (!e.sender.isDestroyed()) e.sender.send(IPC.folderCheckProgress, { done, total });
        },
      });
    } catch (err) {
      if (ctrl.signal.aborted) return null;
      throw err;
    } finally {
      if (folderCheck === ctrl) folderCheck = null;
    }
  });
  ipcMain.handle(IPC.cancelFolderCheck, () => folderCheck?.abort());
  // Originale: prüfen, in einem Ordner suchen, einzeln neu verknüpfen.
  ipcMain.handle(IPC.checkOriginals, (e, sessionId: string, video: boolean) =>
    checkOriginals(requireStore(), sessionId, {
      video,
      onProgress: (done, total, fileName) => {
        if (!e.sender.isDestroyed())
          e.sender.send(IPC.originalsProgress, { sessionId, phase: "prüfen", done, total, fileName });
      },
    }),
  );
  ipcMain.handle(IPC.searchOriginals, async (e, sessionId: string) => {
    const s = requireStore();
    const r = await dialog.showOpenDialog(parentWindow(), {
      title: "Ordner mit den Originalen wählen",
      buttonLabel: "Hier suchen",
      properties: ["openDirectory"],
    });
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return null;
    stillOpen(s);
    const search = searchOriginals(s, sessionId, dir, (done, phase, fileName) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.originalsProgress, { sessionId, phase, done, total: 0, fileName });
    });
    const result = await whileOpen(s, search);
    return { view: buildSessionView(s, sessionId), result };
  });
  ipcMain.handle(IPC.relinkOriginal, async (_e, sourceId: string) => {
    const s = requireStore();
    const src = s.getSource(sourceId);
    const r = await dialog.showOpenDialog(parentWindow(), {
      title: `Originaldatei für ${src.label} (${src.fileName}) wählen`,
      defaultPath: existsSync(dirname(src.originalPath)) ? dirname(src.originalPath) : undefined,
      properties: ["openFile"],
    });
    const path = r.filePaths[0];
    if (r.canceled || !path) return null;
    const sessionId = await whileOpen(s, relinkFile(stillOpen(s), sourceId, path));
    return buildSessionView(s, sessionId);
  });
  ipcMain.handle(IPC.showInFolder, (_e, path: string) => shell.showItemInFolder(path));
}
