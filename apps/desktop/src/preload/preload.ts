/**
 * Brücke zwischen Oberfläche und Hauptprozess. Electron lädt dieses Skript vor der Oberfläche (siehe `createWindow`
 * in `apps/desktop/src/main/main.ts`); es stellt ihr `window.feldspur` bereit, sonst nichts von Node oder Electron.
 *
 * Jede Methode der Schnittstelle (`FeldspurApi`, `apps/desktop/src/shared/api.ts`) reicht ihren Aufruf unverändert an
 * den gleichnamigen Kanal in `IPC` weiter; die Antwort kommt aus `apps/desktop/src/main/ipc/`. Hier steht keine Logik.
 * Die `on…`-Methoden gehen in die andere Richtung: Der Hauptprozess meldet Fortschritt oder bittet die Oberfläche,
 * etwas zu zeichnen; sie geben eine Funktion zum Abmelden zurück.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  IPC,
  type ExportProgress,
  type FeldspurApi,
  type ImportProgress,
  type OriginalsProgress,
  type FolderCheckProgress,
} from "../shared/api.ts";

const api: FeldspurApi = {
  newProject: () => ipcRenderer.invoke(IPC.newProject),
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  recentProjects: () => ipcRenderer.invoke(IPC.recentProjects),
  openRecent: (path) => ipcRenderer.invoke(IPC.openRecent, path),
  forgetRecent: (path) => ipcRenderer.invoke(IPC.forgetRecent, path),
  backups: () => ipcRenderer.invoke(IPC.backups),
  createBackup: () => ipcRenderer.invoke(IPC.createBackup),
  openBackupCopy: (path) => ipcRenderer.invoke(IPC.openBackupCopy, path),
  showBackupFolder: () => ipcRenderer.invoke(IPC.showBackupFolder),
  citationInfo: () => ipcRenderer.invoke(IPC.citationInfo),
  lookupCitationDoi: () => ipcRenderer.invoke(IPC.lookupCitationDoi),
  cancelCitationLookup: () => ipcRenderer.invoke(IPC.cancelCitationLookup),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  copyTable: (html, text) => ipcRenderer.invoke(IPC.copyTable, html, text),
  openCitationLink: (url) => ipcRenderer.invoke(IPC.openCitationLink, url),
  currentProject: () => ipcRenderer.invoke(IPC.currentProject),
  createSession: (input) => ipcRenderer.invoke(IPC.createSession, input),
  getSession: (id) => ipcRenderer.invoke(IPC.getSession, id),
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),
  importPaths: (id, paths) => ipcRenderer.invoke(IPC.importPaths, id, paths),
  cancelImport: (id) => ipcRenderer.invoke(IPC.cancelImport, id),
  onImportProgress: (cb) => {
    const listener = (_e: unknown, p: ImportProgress) => cb(p);
    ipcRenderer.on(IPC.importProgress, listener);
    return () => ipcRenderer.removeListener(IPC.importProgress, listener);
  },
  setReference: (id) => ipcRenderer.invoke(IPC.setReference, id),
  setDeviceUtc: (id, utc) => ipcRenderer.invoke(IPC.setDeviceUtc, id, utc),
  setDeviceTimeZone: (id, tz) => ipcRenderer.invoke(IPC.setDeviceTimeZone, id, tz),
  rereadDevice: (id) => ipcRenderer.invoke(IPC.rereadDevice, id),
  clearDeviceChecks: (id) => ipcRenderer.invoke(IPC.clearDeviceChecks, id),
  renameDevice: (id, label) => ipcRenderer.invoke(IPC.renameDevice, id, label),
  updateSession: (id, patch) => ipcRenderer.invoke(IPC.updateSession, id, patch),
  deleteSession: (id) => ipcRenderer.invoke(IPC.deleteSession, id),
  removeSource: (id) => ipcRenderer.invoke(IPC.removeSource, id),
  moveSource: (id, target) => ipcRenderer.invoke(IPC.moveSource, id, target),
  mergeDevices: (from, into) => ipcRenderer.invoke(IPC.mergeDevices, from, into),
  setPartOf: (id, mainId) => ipcRenderer.invoke(IPC.setPartOf, id, mainId),
  setSourceKind: (id, kind) => ipcRenderer.invoke(IPC.setSourceKind, id, kind),
  setFollows: (id, prevId) => ipcRenderer.invoke(IPC.setFollows, id, prevId),
  addTranscriptLine: (id, line) => ipcRenderer.invoke(IPC.addTranscriptLine, id, line),
  updateTranscriptLine: (id, patch) => ipcRenderer.invoke(IPC.updateTranscriptLine, id, patch),
  deleteTranscriptLine: (id) => ipcRenderer.invoke(IPC.deleteTranscriptLine, id),
  addSourceNote: (id, note) => ipcRenderer.invoke(IPC.addSourceNote, id, note),
  updateSourceNote: (id, patch) => ipcRenderer.invoke(IPC.updateSourceNote, id, patch),
  deleteSourceNote: (id) => ipcRenderer.invoke(IPC.deleteSourceNote, id),
  waveformPeaks: (id, fromMs, toMs, buckets) => ipcRenderer.invoke(IPC.waveformPeaks, id, fromMs, toMs, buckets),
  setDeviceOffset: (id, ms) => ipcRenderer.invoke(IPC.setDeviceOffset, id, ms),
  setDiaryNote: (id, clock) => ipcRenderer.invoke(IPC.setDiaryNote, id, clock),
  analyze: (id) => ipcRenderer.invoke(IPC.analyze, id),
  cancelAnalyze: (id) => ipcRenderer.invoke(IPC.cancelAnalyze, id),
  confirmAnchor: (id) => ipcRenderer.invoke(IPC.confirmAnchor, id),
  confirmAnchors: (sessionId, ids) => ipcRenderer.invoke(IPC.confirmAnchors, sessionId, ids),
  rejectAnchor: (id) => ipcRenderer.invoke(IPC.rejectAnchor, id),
  addTime: (input) => ipcRenderer.invoke(IPC.addTime, input),
  confirmPlacement: (id, startMs) => ipcRenderer.invoke(IPC.confirmPlacement, id, startMs),
  decidePlacement: (input) => ipcRenderer.invoke(IPC.decidePlacement, input),
  decideMany: (input) => ipcRenderer.invoke(IPC.decideMany, input),
  setEvidenceEnabled: (id, enabled) => ipcRenderer.invoke(IPC.setEvidenceEnabled, id, enabled),
  removeEvidence: (id) => ipcRenderer.invoke(IPC.removeEvidence, id),
  addAnchor: (input) => ipcRenderer.invoke(IPC.addAnchor, input),
  replaceAnchor: (id, input) => ipcRenderer.invoke(IPC.replaceAnchor, id, input),
  alignRefine: (input) => ipcRenderer.invoke(IPC.alignRefine, input),
  setLevel: (id, input) => ipcRenderer.invoke(IPC.setLevel, id, input),
  setPageNumbering: (items) => ipcRenderer.invoke(IPC.setPageNumbering, items),
  measureLevel: (id) => ipcRenderer.invoke(IPC.measureLevel, id),
  createDiaryEntry: (sourceId, region) => ipcRenderer.invoke(IPC.createDiaryEntry, sourceId, region),
  addDiaryRegion: (entryId, sourceId, region) => ipcRenderer.invoke(IPC.addDiaryRegion, entryId, sourceId, region),
  removeDiaryRegion: (entryId, index) => ipcRenderer.invoke(IPC.removeDiaryRegion, entryId, index),
  moveDiaryRegion: (entryId, index, region) => ipcRenderer.invoke(IPC.moveDiaryRegion, entryId, index, region),
  setDiaryRegionPage: (entryId, index, pageNo) => ipcRenderer.invoke(IPC.setDiaryRegionPage, entryId, index, pageNo),
  deleteDiaryEntry: (entryId) => ipcRenderer.invoke(IPC.deleteDiaryEntry, entryId),
  patchDiaryEntry: (entryId, patch) => ipcRenderer.invoke(IPC.patchDiaryEntry, entryId, patch),
  setContext: (key, on) => ipcRenderer.invoke(IPC.setContext, key, on),
  setContextDetails: (key, details) => ipcRenderer.invoke(IPC.setContextDetails, key, details),
  moveContext: (key, position) => ipcRenderer.invoke(IPC.moveContext, key, position),
  sortContextByPage: (sessionId) => ipcRenderer.invoke(IPC.sortContextByPage, sessionId),
  setEntryRefs: (entryId, refs) => ipcRenderer.invoke(IPC.setEntryRefs, entryId, refs),
  createContextText: (sessionId, input) => ipcRenderer.invoke(IPC.createContextText, sessionId, input),
  onProgress: (cb) => {
    const listener = (_e: unknown, p: { done: number; total: number; fileName: string }) => cb(p);
    ipcRenderer.on(IPC.progress, listener);
    return () => ipcRenderer.removeListener(IPC.progress, listener);
  },
  undo: (id) => ipcRenderer.invoke(IPC.undo, id),
  moveEpisodeEdge: (id, edge, from, to) => ipcRenderer.invoke(IPC.moveEpisodeEdge, id, edge, from, to),
  addEpisodeAround: (id, at) => ipcRenderer.invoke(IPC.addEpisodeAround, id, at),
  resetEpisodes: (id) => ipcRenderer.invoke(IPC.resetEpisodes, id),
  envelopes: (id) => ipcRenderer.invoke(IPC.envelopes, id),
  redo: (id) => ipcRenderer.invoke(IPC.redo, id),
  historyState: () => ipcRenderer.invoke(IPC.historyState),
  changeLog: (opts) => ipcRenderer.invoke(IPC.changeLog, opts),
  exportChangeLog: () => ipcRenderer.invoke(IPC.exportChangeLog),
  pathForFile: (file) => webUtils.getPathForFile(file),
  importTranscript: (id, opts) => ipcRenderer.invoke(IPC.importTranscript, id, opts),
  previewExport: (id, realtime) => ipcRenderer.invoke(IPC.previewExport, id, realtime),
  exportStatus: (id, opts) => ipcRenderer.invoke(IPC.exportStatus, id, opts),
  exportCard: (id, opts) => ipcRenderer.invoke(IPC.exportCard, id, opts),
  openExportFile: (id, name) => ipcRenderer.invoke(IPC.openExportFile, id, name),
  projectOverview: () => ipcRenderer.invoke(IPC.projectOverview),
  setProjectDataset: (dataset) => ipcRenderer.invoke(IPC.setProjectDataset, dataset),
  saveFieldCalendar: (days) => ipcRenderer.invoke(IPC.saveFieldCalendar, days),
  montagePreview: (id, realtime) => ipcRenderer.invoke(IPC.montagePreview, id, realtime),
  setMontageFormat: (id, format) => ipcRenderer.invoke(IPC.setMontageFormat, id, format),
  exportSession: (id, opts) => ipcRenderer.invoke(IPC.exportSession, id, opts),
  cancelExport: (id) => ipcRenderer.invoke(IPC.cancelExport, id),
  onExportProgress: (cb) => {
    const listener = (_e: unknown, p: ExportProgress) => cb(p);
    ipcRenderer.on(IPC.exportProgress, listener);
    return () => ipcRenderer.removeListener(IPC.exportProgress, listener);
  },
  // Anfrage und Antwort gehören über `id` zusammen; der Hauptprozess wartet darauf (`askRenderer` in main/export.ts).
  onOverlayRequest: (render) => {
    const listener = (_e: unknown, id: number, timeline: unknown, frames: unknown[], format: unknown) => {
      render(timeline, frames, format).then(
        (pngs) => ipcRenderer.send(IPC.overlayReply, id, pngs, null),
        (err: unknown) => ipcRenderer.send(IPC.overlayReply, id, [], String(err)),
      );
    };
    ipcRenderer.on(IPC.overlayRequest, listener);
    return () => ipcRenderer.removeListener(IPC.overlayRequest, listener);
  },
  onStillRequest: (render) => {
    const listener = (_e: unknown, id: number, ref: unknown, pdf: boolean) => {
      render(ref, pdf).then(
        (jpeg) => ipcRenderer.send(IPC.stillReply, id, jpeg),
        () => ipcRenderer.send(IPC.stillReply, id, null),
      );
    };
    ipcRenderer.on(IPC.stillRequest, listener);
    return () => ipcRenderer.removeListener(IPC.stillRequest, listener);
  },
  showInFolder: (path) => ipcRenderer.invoke(IPC.showInFolder, path),
  checkOriginals: (id, video) => ipcRenderer.invoke(IPC.checkOriginals, id, video),
  searchOriginals: (id) => ipcRenderer.invoke(IPC.searchOriginals, id),
  relinkOriginal: (id) => ipcRenderer.invoke(IPC.relinkOriginal, id),
  checkFolder: (dir) => ipcRenderer.invoke(IPC.checkFolder, dir),
  cancelFolderCheck: () => ipcRenderer.invoke(IPC.cancelFolderCheck),
  onFolderCheckProgress: (cb) => {
    const listener = (_e: unknown, p: FolderCheckProgress) => cb(p);
    ipcRenderer.on(IPC.folderCheckProgress, listener);
    return () => ipcRenderer.removeListener(IPC.folderCheckProgress, listener);
  },
  onOriginalsProgress: (cb) => {
    const listener = (_e: unknown, p: OriginalsProgress) => cb(p);
    ipcRenderer.on(IPC.originalsProgress, listener);
    return () => ipcRenderer.removeListener(IPC.originalsProgress, listener);
  },
};

contextBridge.exposeInMainWorld("feldspur", api);
