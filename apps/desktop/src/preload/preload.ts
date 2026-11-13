import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC, type FeldspurApi } from "../shared/api.ts";

const api: FeldspurApi = {
  newProject: () => ipcRenderer.invoke(IPC.newProject),
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  currentProject: () => ipcRenderer.invoke(IPC.currentProject),
  createSession: (input) => ipcRenderer.invoke(IPC.createSession, input),
  getSession: (id) => ipcRenderer.invoke(IPC.getSession, id),
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),
  importPaths: (id, paths) => ipcRenderer.invoke(IPC.importPaths, id, paths),
  setReference: (id) => ipcRenderer.invoke(IPC.setReference, id),
  setDeviceUtc: (id, utc) => ipcRenderer.invoke(IPC.setDeviceUtc, id, utc),
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
  setDeviceOffset: (id, ms) => ipcRenderer.invoke(IPC.setDeviceOffset, id, ms),
  setDiaryNote: (id, clock) => ipcRenderer.invoke(IPC.setDiaryNote, id, clock),
  analyze: (id) => ipcRenderer.invoke(IPC.analyze, id),
  confirmAnchor: (id) => ipcRenderer.invoke(IPC.confirmAnchor, id),
  rejectAnchor: (id) => ipcRenderer.invoke(IPC.rejectAnchor, id),
  addTime: (input) => ipcRenderer.invoke(IPC.addTime, input),
  setEvidenceEnabled: (id, enabled) => ipcRenderer.invoke(IPC.setEvidenceEnabled, id, enabled),
  removeEvidence: (id) => ipcRenderer.invoke(IPC.removeEvidence, id),
  addAnchor: (input) => ipcRenderer.invoke(IPC.addAnchor, input),
  createDiaryEntry: (sourceId, region) => ipcRenderer.invoke(IPC.createDiaryEntry, sourceId, region),
  addDiaryRegion: (entryId, sourceId, region) => ipcRenderer.invoke(IPC.addDiaryRegion, entryId, sourceId, region),
  removeDiaryRegion: (entryId, index) => ipcRenderer.invoke(IPC.removeDiaryRegion, entryId, index),
  deleteDiaryEntry: (entryId) => ipcRenderer.invoke(IPC.deleteDiaryEntry, entryId),
  patchDiaryEntry: (entryId, patch) => ipcRenderer.invoke(IPC.patchDiaryEntry, entryId, patch),
  onProgress: (cb) => {
    const listener = (_e: unknown, p: { done: number; total: number; fileName: string }) => cb(p);
    ipcRenderer.on(IPC.progress, listener);
    return () => ipcRenderer.removeListener(IPC.progress, listener);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld("feldspur", api);
