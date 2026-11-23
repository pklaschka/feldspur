import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, protocol } from "electron";
import { pruneMontageCache, setLogEnabled, setToolPaths } from "@feldspur/media";
import { MEDIA_SCHEME } from "../shared/api.ts";
import { abortExport, montageCacheRoot, exportRunning } from "./export.ts";
import { fileResponse } from "./media-response.ts";
import { resolveToolPaths } from "./tools.ts";
import { AUTO_BACKUP_CHECK_MS } from "./backup.ts";
import { registerIpc } from "./ipc/index.ts";
import { autoBackup, closeStore, currentStore, mainWindow, openStore, setWindow } from "./state.ts";

/** App-Symbol fürs Fenster (Linux/Windows) und „Über Feldspur“: im Paket unter resources/, beim Entwickeln aus packaging/. */
function appIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? "", "icon.png"),
    join(app.getAppPath(), "..", "..", "packaging", "icon.png"),
  ];
  return candidates.find((p) => existsSync(p));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: "Feldspur",
    icon: appIcon(),
    backgroundColor: "#f6f8f7",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  setWindow(win);
  win.maximize();
  // Keine Navigation weg von der App, keine neuen Fenster.
  win.on("close", (e) => {
    if (!exportRunning()) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Weiter ausgeben", "Abbrechen und schließen"],
      defaultId: 0,
      cancelId: 0,
      message: "Es läuft noch eine Ausgabe.",
      detail: "Beim Schließen bricht sie ab; die halb geschriebenen Dateien bleiben unvollständig.",
    });
    if (choice === 0) e.preventDefault();
    else abortExport();
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
      const s = currentStore();
      if (url.host !== "source" || !s) return new Response("Nicht gefunden", { status: 404 });
      const src = s.getSource(id);
      return fileResponse(src.originalPath, src.fileName, req.headers.get("range"));
    } catch {
      return new Response("Nicht gefunden", { status: 404 });
    }
  });
}

// Tests: eigener Benutzerordner, damit z. B. „Zuletzt geöffnet“ nichts vom Rechner mitnimmt.
if (process.env.FELDSPUR_USER_DATA) app.setPath("userData", process.env.FELDSPUR_USER_DATA);

app.setAboutPanelOptions({
  applicationName: "Feldspur",
  applicationVersion: app.getVersion(),
  copyright: "© 2026 Zuri Nimca Klaschka\nLizenziert unter der EUPL-1.2",
  website: "https://github.com/pklaschka/feldspur",
  iconPath: appIcon(),
});

// Windows und Linux: Ein Doppelklick auf eine Projektdatei startet das Programm noch einmal, mit dem Pfad als
// Argument. Läuft Feldspur schon, übernimmt das laufende Fenster die Datei, statt ein zweites zu öffnen.
// In Tests (eigener Benutzerordner) laufen mehrere Instanzen nebeneinander.
const primaryInstance = Boolean(process.env.FELDSPUR_USER_DATA) || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

app.on("second-instance", (_e, argv) => {
  const win = mainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  const path = argv.find((a) => a.endsWith(".feldspur"));
  // Während einer Ausgabe nicht das Projekt unter ihr wechseln.
  if (!path || !existsSync(path) || exportRunning()) return;
  try {
    openStore(path, false);
  } catch (e) {
    showOpenError((e as Error).message);
    return;
  }
  mainWindow()?.webContents.reload();
});

/** Fehler beim Öffnen außerhalb der Oberfläche (Doppelklick, „Öffnen mit“) als Meldung zeigen. */
function showOpenError(detail: string): void {
  const opts = { type: "error" as const, message: "Projekt lässt sich nicht öffnen", detail };
  const win = mainWindow();
  void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
}

// Arbeitsprotokoll auf der Konsole (Issue #168): beim Entwickeln (nicht gepackt) an. Oberflächentests mit eigenem
// Benutzerordner bleiben leise; FELDSPUR_LOG=1 schaltet es überall ein (auch in der installierten App), =0 ab.
setLogEnabled(!app.isPackaged && !process.env.FELDSPUR_USER_DATA);

void app.whenReady().then(() => {
  if (!primaryInstance) return;
  registerMediaProtocol();
  registerIpc();
  // Für Tests und „Öffnen mit“: Projektpfad als Argument.
  const arg = process.argv.find((a) => a.endsWith(".feldspur"));
  let failed: string | null = null;
  if (arg)
    try {
      openStore(arg, !existsSync(arg));
    } catch (e) {
      failed = (e as Error).message;
    }
  createWindow();
  if (failed) showOpenError(failed);
  setInterval(() => autoBackup.tick(), AUTO_BACKUP_CHECK_MS).unref();
  // Zwischenspeicher lange nicht ausgegebener Einsätze wegräumen; ein Fehler dabei stört nichts.
  void pruneMontageCache(montageCacheRoot()).catch(() => {});
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
  try {
    openStore(path, false);
  } catch (e) {
    showOpenError((e as Error).message);
    return;
  }
  mainWindow()?.webContents.reload();
});

app.on("window-all-closed", () => {
  closeStore();
  app.quit();
});
