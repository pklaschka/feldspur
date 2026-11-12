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
  renameDevice: (id, label) => ipcRenderer.invoke(IPC.renameDevice, id, label),
  setDeviceOffset: (id, ms) => ipcRenderer.invoke(IPC.setDeviceOffset, id, ms),
  setDiaryNote: (id, clock) => ipcRenderer.invoke(IPC.setDiaryNote, id, clock),
  analyze: (id) => ipcRenderer.invoke(IPC.analyze, id),
  confirmAnchor: (id) => ipcRenderer.invoke(IPC.confirmAnchor, id),
  rejectAnchor: (id) => ipcRenderer.invoke(IPC.rejectAnchor, id),
  onProgress: (cb) => {
    const listener = (_e: unknown, p: { done: number; total: number; fileName: string }) => cb(p);
    ipcRenderer.on(IPC.progress, listener);
    return () => ipcRenderer.removeListener(IPC.progress, listener);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld("feldspur", api);
