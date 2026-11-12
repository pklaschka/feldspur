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
  setDeviceOffset: (id, ms) => ipcRenderer.invoke(IPC.setDeviceOffset, id, ms),
  setDiaryNote: (id, clock) => ipcRenderer.invoke(IPC.setDiaryNote, id, clock),
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld("feldspur", api);
