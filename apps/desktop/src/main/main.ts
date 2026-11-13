import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { localMs, ProjectStore } from "@feldspur/core";
import {
  analyzeSession,
  applyImport,
  parseTranscript,
  scanPaths,
  setToolPaths,
  TRANSCRIPT_EXTENSIONS,
} from "@feldspur/media";
import {
  IPC,
  MEDIA_SCHEME,
  type AnchorInput,
  type DiaryPatch,
  type Region,
  type ImportOutcome,
  type TimeInput,
  type NewSessionInput,
  type SessionPatch,
  type TranscriptPatch,
  type ProjectInfo,
} from "../shared/api.ts";
import { addRegion, createEntry, deleteEntry, patchEntry, removeRegion } from "./diary.ts";
import { addManualAnchor, addTimeEvidence, removeEvidence, toggleEvidence } from "./edits.ts";
import { exportRunning, montagePlan, previewExport, registerOverlayBridge, runExport } from "./export.ts";
import { fileResponse } from "./media-response.ts";
import { updateSessionDetails } from "./session.ts";
import { linkFollowUps, mergeDevices, moveSource, removeSource, setFollows, setPartOf } from "./sources.ts";
import { resolveToolPaths } from "./tools.ts";
import { addLine, deleteLine, importLines, updateLine } from "./transcript.ts";
import { buildSessionView } from "./view.ts";
import { forgetProject, recentProjects, rememberProject } from "./recent.ts";

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
  if (exportRunning()) throw new Error("Während einer Ausgabe lässt sich kein anderes Projekt öffnen.");
  store?.close();
  const binding = nativeBinding();
  const opts = binding ? { nativeBinding: binding } : {};
  store = create
    ? ProjectStore.create(path, { name: basename(path).replace(/\.feldspur$/, ""), ...opts })
    : ProjectStore.open(path, opts);
  const info = projectInfo()!;
  win?.setTitle(`Feldspur · ${info.name}`);
  rememberProject(info.path, info.name);
  return info;
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

  ipcMain.handle(IPC.recentProjects, () => recentProjects());
  ipcMain.handle(IPC.openRecent, (_e, path: string) => {
    if (!existsSync(path)) throw new Error(`Projekt nicht gefunden: ${path}`);
    return openStore(path, false);
  });
  ipcMain.handle(IPC.forgetRecent, (_e, path: string) => forgetProject(path));

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
    linkFollowUps(s, sessionId);
    return {
      added: res.sources.length,
      duplicates: res.duplicates.length,
      warnings: plan.flatMap((c) => c.warnings.map((message) => ({ fileName: c.fileName, message }))),
      view: buildSessionView(s, sessionId),
    };
  });

  ipcMain.handle(IPC.renameDevice, (_e, deviceId: string, label: string) => {
    const s = requireStore();
    const d = s.updateDevice(deviceId, { label: label.trim() || s.getDevice(deviceId).label });
    return buildSessionView(s, d.sessionId);
  });

  ipcMain.handle(IPC.updateSession, (_e, sessionId: string, patch: SessionPatch) => {
    const s = requireStore();
    updateSessionDetails(s, sessionId, patch);
    return { view: buildSessionView(s, sessionId), project: projectInfo()! };
  });
  ipcMain.handle(IPC.removeSource, (_e, sourceId: string) => {
    const s = requireStore();
    return buildSessionView(s, removeSource(s, sourceId));
  });
  ipcMain.handle(IPC.moveSource, (_e, sourceId: string, target: string | { newLabel: string }) => {
    const s = requireStore();
    return buildSessionView(s, moveSource(s, sourceId, target));
  });
  ipcMain.handle(IPC.mergeDevices, (_e, fromId: string, intoId: string) => {
    const s = requireStore();
    return buildSessionView(s, mergeDevices(s, fromId, intoId));
  });
  ipcMain.handle(IPC.setPartOf, (_e, sourceId: string, mainId: string | null) => {
    const s = requireStore();
    return buildSessionView(s, setPartOf(s, sourceId, mainId));
  });
  ipcMain.handle(IPC.setFollows, (_e, sourceId: string, prevId: string | null) => {
    const s = requireStore();
    return buildSessionView(s, setFollows(s, sourceId, prevId));
  });

  ipcMain.handle(
    IPC.addTranscriptLine,
    (_e, sourceId: string, line: { atMs: number; speaker: string; text: string }) => {
      const s = requireStore();
      const l = addLine(s, sourceId, line);
      return { view: buildSessionView(s, s.getSource(sourceId).sessionId), lineId: l.id };
    },
  );
  ipcMain.handle(IPC.updateTranscriptLine, (_e, lineId: string, patch: TranscriptPatch) => {
    const s = requireStore();
    return buildSessionView(s, updateLine(s, lineId, patch));
  });
  ipcMain.handle(IPC.deleteTranscriptLine, (_e, lineId: string) => {
    const s = requireStore();
    return buildSessionView(s, deleteLine(s, lineId));
  });

  registerOverlayBridge();
  ipcMain.handle(
    IPC.importTranscript,
    async (_e, sourceId: string, opts: { mode: "append" | "replace"; path?: string }) => {
      const s = requireStore();
      let path = opts.path;
      if (!path) {
        const r = await dialog.showOpenDialog(win!, {
          title: "Transkript importieren",
          properties: ["openFile"],
          filters: [{ name: "Transkript (Whisper u. a.)", extensions: TRANSCRIPT_EXTENSIONS }],
        });
        if (r.canceled || !r.filePaths[0]) return null;
        path = r.filePaths[0];
      }
      const lines = parseTranscript(await readFile(path, "utf8"), basename(path));
      const r = importLines(s, sourceId, lines, opts.mode);
      return { view: buildSessionView(s, r.sessionId), count: r.count, dropped: r.dropped };
    },
  );
  ipcMain.handle(IPC.previewExport, (_e, sessionId: string) => previewExport(requireStore(), sessionId));
  ipcMain.handle(IPC.montagePreview, (_e, sessionId: string) => montagePlan(requireStore(), sessionId));
  ipcMain.handle(
    IPC.exportSession,
    async (e, sessionId: string, opts: { video: boolean; resolve?: boolean; mixAudio?: boolean; dir?: string }) => {
      const s = requireStore();
      let parent = opts.dir;
      if (!parent) {
        const r = await dialog.showOpenDialog(win!, {
          title: "Wohin ausgeben?",
          buttonLabel: "Hier ausgeben",
          properties: ["openDirectory", "createDirectory"],
        });
        if (r.canceled || !r.filePaths[0]) return null;
        parent = r.filePaths[0];
      }
      return runExport(s, e.sender, sessionId, parent, opts);
    },
  );
  ipcMain.handle(IPC.showInFolder, (_e, path: string) => shell.showItemInFolder(path));

  ipcMain.handle(IPC.setReference, (_e, deviceId: string) => {
    const s = requireStore();
    const d = s.setReferenceDevice(deviceId);
    return buildSessionView(s, d.sessionId);
  });

  ipcMain.handle(IPC.setDeviceTimeZone, (_e, deviceId: string, timeZone: string | null) => {
    const s = requireStore();
    const zone = timeZone?.trim() || null;
    if (zone) {
      try {
        new Intl.DateTimeFormat("de", { timeZone: zone });
      } catch {
        throw new Error(`Unbekannte Zeitzone „${zone}“`);
      }
    }
    const d = s.updateDevice(deviceId, { timeZone: zone });
    return buildSessionView(s, d.sessionId);
  });
  ipcMain.handle(IPC.setDeviceUtc, (_e, deviceId: string, utc: boolean) => {
    const s = requireStore();
    const d = s.updateDevice(deviceId, { timestampsAreUtc: utc });
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

  ipcMain.handle(IPC.addTime, (_e, input: TimeInput) => {
    const s = requireStore();
    return buildSessionView(s, addTimeEvidence(s, input));
  });

  ipcMain.handle(IPC.setEvidenceEnabled, (_e, evidenceId: string, enabled: boolean) => {
    const s = requireStore();
    return buildSessionView(s, toggleEvidence(s, evidenceId, enabled));
  });

  ipcMain.handle(IPC.removeEvidence, (_e, evidenceId: string) => {
    const s = requireStore();
    return buildSessionView(s, removeEvidence(s, evidenceId));
  });

  ipcMain.handle(IPC.addAnchor, (_e, input: AnchorInput) => {
    const s = requireStore();
    return buildSessionView(s, addManualAnchor(s, input));
  });

  ipcMain.handle(IPC.createDiaryEntry, (_e, sourceId: string, region: Region) => {
    const s = requireStore();
    const r = createEntry(s, sourceId, region);
    return { view: buildSessionView(s, r.sessionId), entryId: r.entry.id };
  });
  ipcMain.handle(IPC.addDiaryRegion, (_e, entryId: string, sourceId: string, region: Region) => {
    const s = requireStore();
    return buildSessionView(s, addRegion(s, entryId, sourceId, region));
  });
  ipcMain.handle(IPC.removeDiaryRegion, (_e, entryId: string, index: number) => {
    const s = requireStore();
    return buildSessionView(s, removeRegion(s, entryId, index));
  });
  ipcMain.handle(IPC.deleteDiaryEntry, (_e, entryId: string) => {
    const s = requireStore();
    return buildSessionView(s, deleteEntry(s, entryId));
  });
  ipcMain.handle(IPC.patchDiaryEntry, (_e, entryId: string, patch: DiaryPatch) => {
    const s = requireStore();
    return buildSessionView(s, patchEntry(s, entryId, patch));
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
  win.maximize();
  // Keine Navigation weg von der App, keine neuen Fenster.
  win.on("close", (e) => {
    if (!exportRunning()) return;
    const choice = dialog.showMessageBoxSync(win!, {
      type: "warning",
      buttons: ["Weiter ausgeben", "Abbrechen und schließen"],
      defaultId: 0,
      cancelId: 0,
      message: "Es läuft noch eine Ausgabe.",
      detail: "Beim Schließen bricht sie ab; die halb geschriebenen Dateien bleiben unvollständig.",
    });
    if (choice === 0) e.preventDefault();
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const devUrl = process.env.FELDSPUR_DEV_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

setToolPaths(
  resolveToolPaths(process.env, process.resourcesPath ?? null, process.platform === "win32" ? ".exe" : "", existsSync),
);

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

/** Originale für Vorschau und Wiedergabe ausliefern: nur Quellen des offenen Projekts, nur Bild-, Audio- und Videodateien. */
function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    try {
      const url = new URL(req.url);
      const id = decodeURIComponent(url.pathname.replace(/^\//, ""));
      if (url.host !== "source" || !store) return new Response("Nicht gefunden", { status: 404 });
      const src = store.getSource(id);
      return fileResponse(src.originalPath, src.fileName, req.headers.get("range"));
    } catch {
      return new Response("Nicht gefunden", { status: 404 });
    }
  });
}

// Tests: eigener Benutzerordner, damit z. B. „Zuletzt geöffnet“ nichts vom Rechner mitnimmt.
if (process.env.FELDSPUR_USER_DATA) app.setPath("userData", process.env.FELDSPUR_USER_DATA);

void app.whenReady().then(() => {
  registerMediaProtocol();
  registerIpc();
  // Für Tests und „Öffnen mit“: Projektpfad als Argument.
  const arg = process.argv.find((a) => a.endsWith(".feldspur"));
  if (arg) openStore(arg, !existsSync(arg));
  createWindow();
});

// macOS: Projekt aus dem Dock („Zuletzt benutzt“) oder per Doppelklick im Finder öffnen.
app.on("open-file", (e, path) => {
  e.preventDefault();
  // Während einer Ausgabe nicht das Projekt unter ihr wechseln.
  if (!path.endsWith(".feldspur") || !existsSync(path) || exportRunning()) return;
  if (!app.isReady()) {
    process.argv.push(path);
    return;
  }
  openStore(path, false);
  win?.webContents.reload();
});

app.on("window-all-closed", () => {
  store?.close();
  store = null;
  app.quit();
});
