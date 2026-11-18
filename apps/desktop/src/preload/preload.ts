import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC, type ExportProgress, type FeldspurApi, type OriginalsProgress } from "../shared/api.ts";

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
  currentProject: () => ipcRenderer.invoke(IPC.currentProject),
  createSession: (input) => ipcRenderer.invoke(IPC.createSession, input),
  getSession: (id) => ipcRenderer.invoke(IPC.getSession, id),
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),
  importPaths: (id, paths) => ipcRenderer.invoke(IPC.importPaths, id, paths),
  setReference: (id) => ipcRenderer.invoke(IPC.setReference, id),
  setDeviceUtc: (id, utc) => ipcRenderer.invoke(IPC.setDeviceUtc, id, utc),
  setDeviceTimeZone: (id, tz) => ipcRenderer.invoke(IPC.setDeviceTimeZone, id, tz),
  renameDevice: (id, label) => ipcRenderer.invoke(IPC.renameDevice, id, label),
  updateSession: (id, patch) => ipcRenderer.invoke(IPC.updateSession, id, patch),
  removeSource: (id) => ipcRenderer.invoke(IPC.removeSource, id),
  moveSource: (id, target) => ipcRenderer.invoke(IPC.moveSource, id, target),
  mergeDevices: (from, into) => ipcRenderer.invoke(IPC.mergeDevices, from, into),
  setPartOf: (id, mainId) => ipcRenderer.invoke(IPC.setPartOf, id, mainId),
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
  confirmAnchor: (id) => ipcRenderer.invoke(IPC.confirmAnchor, id),
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
  setDiaryRegionPage: (entryId, index, pageNo) => ipcRenderer.invoke(IPC.setDiaryRegionPage, entryId, index, pageNo),
  deleteDiaryEntry: (entryId) => ipcRenderer.invoke(IPC.deleteDiaryEntry, entryId),
  patchDiaryEntry: (entryId, patch) => ipcRenderer.invoke(IPC.patchDiaryEntry, entryId, patch),
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
  montagePreview: (id, realtime) => ipcRenderer.invoke(IPC.montagePreview, id, realtime),
  exportSession: (id, opts) => ipcRenderer.invoke(IPC.exportSession, id, opts),
  onExportProgress: (cb) => {
    const listener = (_e: unknown, p: ExportProgress) => cb(p);
    ipcRenderer.on(IPC.exportProgress, listener);
    return () => ipcRenderer.removeListener(IPC.exportProgress, listener);
  },
  onOverlayRequest: (render) => {
    const listener = (_e: unknown, id: number, timeline: unknown, frames: unknown[]) => {
      render(timeline, frames).then(
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
  onOriginalsProgress: (cb) => {
    const listener = (_e: unknown, p: OriginalsProgress) => cb(p);
    ipcRenderer.on(IPC.originalsProgress, listener);
    return () => ipcRenderer.removeListener(IPC.originalsProgress, listener);
  },
};

contextBridge.exposeInMainWorld("feldspur", api);
