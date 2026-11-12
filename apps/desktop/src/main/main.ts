import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { localMs, ProjectStore } from "@feldspur/core";
import { analyzeSession, applyImport, scanPaths, setToolPaths } from "@feldspur/media";
import { IPC, type ImportOutcome, type NewSessionInput, type ProjectInfo } from "../shared/api.ts";
import { buildSessionView } from "./view.ts";

let store: ProjectStore | null = null;
let win: BrowserWindow | null = null;

/** Electron braucht eine eigene Bauart von better-sqlite3 (siehe scripts/fetch-electron-sqlite.mjs). */
function nativeBinding(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? "", "native", "better_sqlite3.node"),
    join(app.getAppPath(), "native", `${process.platform}-${process.arch}`, "better_sqlite3.node"),
  ];
  return candidates.find((p) => existsSync(p));
}

function projectInfo(): ProjectInfo | null {
  if (!store) return null;
  return { path: store.path, name: store.getMeta("name") ?? basename(store.path), sessions: store.listSessions() };
}

function requireStore(): ProjectStore {
  if (!store) throw new Error("Kein Projekt geöffnet");
  return store;
}

function openStore(path: string, create: boolean): ProjectInfo | null {
  store?.close();
  const binding = nativeBinding();
  const opts = binding ? { nativeBinding: binding } : {};
  store = create
    ? ProjectStore.create(path, { name: basename(path).replace(/\.feldspur$/, ""), ...opts })
    : ProjectStore.open(path, opts);
  win?.setTitle(`Feldspur · ${projectInfo()?.name}`);
  return projectInfo();
}

function registerIpc(): void {
  ipcMain.handle(IPC.currentProject, () => projectInfo());

  ipcMain.handle(IPC.newProject, async () => {
    const r = await dialog.showSaveDialog(win!, {
      title: "Neues Feldspur-Projekt",
      defaultPath: "Feldforschung.feldspur",
      filters: [{ name: "Feldspur-Projekt", extensions: ["feldspur"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const path = r.filePath.endsWith(".feldspur") ? r.filePath : `${r.filePath}.feldspur`;
    return openStore(path, !existsSync(path));
  });

  ipcMain.handle(IPC.openProject, async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Feldspur-Projekt öffnen",
      properties: ["openFile"],
      filters: [{ name: "Feldspur-Projekt", extensions: ["feldspur"] }],
    });
    const path = r.filePaths[0];
    return r.canceled || !path ? null : openStore(path, false);
  });

  ipcMain.handle(IPC.createSession, (_e, input: NewSessionInput) => {
    requireStore().addSession(input);
    return projectInfo();
  });

  ipcMain.handle(IPC.getSession, (_e, id: string) => buildSessionView(requireStore(), id));

  ipcMain.handle(IPC.pickFiles, async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Quellen hinzufügen",
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle(IPC.importPaths, async (_e, sessionId: string, paths: string[]): Promise<ImportOutcome> => {
    const s = requireStore();
    const plan = await scanPaths(paths);
    const res = applyImport(s, sessionId, plan);
    return {
      added: res.sources.length,
      duplicates: res.duplicates.length,
      warnings: plan.flatMap((c) => c.warnings.map((message) => ({ fileName: c.fileName, message }))),
      view: buildSessionView(s, sessionId),
    };
  });

  ipcMain.handle(IPC.setReference, (_e, deviceId: string) => {
    const s = requireStore();
    const d = s.setReferenceDevice(deviceId);
    return buildSessionView(s, d.sessionId);
  });

  ipcMain.handle(IPC.setDiaryNote, (_e, sourceId: string, clock: string) => {
    const s = requireStore();
    return buildSessionView(s, setDiaryNote(s, sourceId, clock));
  });

  ipcMain.handle(IPC.analyze, async (e, sessionId: string) => {
    const s = requireStore();
    const r = await analyzeSession(s, sessionId, {
      onProgress: (done, total, fileName) => e.sender.send(IPC.progress, { done, total, fileName }),
    });
    return {
      view: buildSessionView(s, sessionId),
      analyzed: r.analyzed,
      failed: r.failed.map((f) => `${f.fileName}: ${f.message}`),
    };
  });

  ipcMain.handle(IPC.confirmAnchor, (_e, anchorId: string) => {
    const s = requireStore();
    const a = s.getAnchor(anchorId);
    s.confirmAnchor(anchorId);
    // Weitere Vorschläge für dasselbe Gerät sind damit erledigt: seine Uhr ist jetzt abgeglichen.
    const device = s.getSource(a.b.sourceId).deviceId;
    for (const other of s.listAnchors(a.sessionId)) {
      if (other.proposed && device && s.getSource(other.b.sourceId).deviceId === device) s.deleteAnchor(other.id);
    }
    return buildSessionView(s, a.sessionId);
  });

  ipcMain.handle(IPC.rejectAnchor, (_e, anchorId: string) => {
    const s = requireStore();
    const a = s.getAnchor(anchorId);
    s.deleteAnchor(anchorId);
    return buildSessionView(s, a.sessionId);
  });

  ipcMain.handle(IPC.setDeviceOffset, (_e, deviceId: string, offsetMs: number | null) => {
    const s = requireStore();
    const d = s.updateDevice(
      deviceId,
      offsetMs === null
        ? { offsetBasis: "unknown", clockOffsetMs: 0, isReference: false }
        : {
            offsetBasis: "manual",
            clockOffsetMs: Math.round(offsetMs),
            clockOffsetUncertaintyMs: 1000,
            isReference: false,
          },
    );
    return buildSessionView(s, d.sessionId);
  });
}

function setDiaryNote(s: ProjectStore, sourceId: string, clock: string): string {
  const src = s.getSource(sourceId);
  if (src.kind !== "diary") throw new Error("Keine Tagebuchseite");
  const session = s.getSession(src.sessionId);
  const entries = s.listDiaryEntries(session.id).filter((e) => e.regions.some((r) => r.sourceId === sourceId));
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(clock.trim());
  let notedAtMs: number | null = null;
  if (clock.trim()) {
    if (!m) throw new Error(`Uhrzeit bitte als hh:mm, nicht „${clock}“`);
    const [y, mo, d] = session.date.split("-").map(Number) as [number, number, number];
    notedAtMs = localMs(y, mo, d, Number(m[1]), Number(m[2]));
  }
  const first = entries[0];
  if (first) s.updateDiaryEntry(first.id, { notedAtMs });
  else if (notedAtMs !== null) s.addDiaryEntry({ sessionId: session.id, regions: [{ sourceId }], notedAtMs });
  return session.id;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: "Feldspur",
    backgroundColor: "#f6f8f7",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Keine Navigation weg von der App, keine neuen Fenster.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const devUrl = process.env.FELDSPUR_DEV_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

if (process.env.FELDSPUR_FFPROBE || process.env.FELDSPUR_FFMPEG) {
  setToolPaths({
    ...(process.env.FELDSPUR_FFPROBE ? { ffprobe: process.env.FELDSPUR_FFPROBE } : {}),
    ...(process.env.FELDSPUR_FFMPEG ? { ffmpeg: process.env.FELDSPUR_FFMPEG } : {}),
  });
}

void app.whenReady().then(() => {
  registerIpc();
  // Für Tests und „Öffnen mit“: Projektpfad als Argument.
  const arg = process.argv.find((a) => a.endsWith(".feldspur"));
  if (arg) openStore(arg, !existsSync(arg));
  createWindow();
});

app.on("window-all-closed", () => {
  store?.close();
  store = null;
  app.quit();
});
