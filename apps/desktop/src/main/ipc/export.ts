/** IPC-Aufrufe fürs Ausgeben: Vorschau, Stand, Ausgabe, Originale prüfen und wiederfinden. */
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
    return runExport(s, e.sender, sessionId, parent, { ...opts, software });
  });
  ipcMain.handle(IPC.cancelExport, (_e, sessionId: string) => cancelExport(sessionId));
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
