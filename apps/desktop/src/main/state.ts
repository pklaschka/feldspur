/**
 * Zustand des Hauptprozesses: offenes Projekt, Fenster, laufende Arbeiten. Die IPC-Aufrufe in ipc/ greifen nur
 * hierüber darauf zu; `stillOpen` hält die Regel für Aufrufe mit `await` fest.
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { app, type BrowserWindow } from "electron";
import { backupDir, checkProjectFile, listBackups, ProjectStore } from "@feldspur/core";
import type { ProjectInfo } from "../shared/api.ts";
import { abortExport, exportRunning } from "./export.ts";
import { rememberProject } from "./recent.ts";
import { AutoBackup } from "./backup.ts";

let store: ProjectStore | null = null;
let win: BrowserWindow | null = null;
/** Zuletzt gescheitertes Öffnen: dort sucht „Sicherung als Kopie öffnen…“ zuerst nach Sicherungen. */
let failedPath: string | null = null;
/** Laufendes Einsammeln je Einsatz, zum Abbrechen. */
export const importing = new Map<string, AbortController>();
/** Einsätze, deren Tonspuren gerade analysiert werden, zum Abbrechen. */
export const analyzing = new Map<string, AbortController>();
export const autoBackup = new AutoBackup();

/** Das offene Projekt, falls eins offen ist. */
export const currentStore = (): ProjectStore | null => store;

export const lastFailedPath = (): string | null => failedPath;

export const mainWindow = (): BrowserWindow | null => win;

/** Das Hauptfenster als Eltern für Dialoge. */
export const parentWindow = (): BrowserWindow => win!;

export function setWindow(w: BrowserWindow): void {
  win = w;
}

/** Die gebündelte App lädt better-sqlite3 über eine Datei neben der App (siehe scripts/fetch-electron-sqlite.mjs). */
function nativeBinding(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? "", "native", "better_sqlite3.node"),
    join(app.getAppPath(), "native", `${process.platform}-${process.arch}`, "better_sqlite3.node"),
  ];
  return candidates.find((p) => existsSync(p));
}

export function projectInfo(): ProjectInfo | null {
  if (!store) return null;
  return { path: store.path, name: store.getMeta("name") ?? basename(store.path), sessions: store.listSessions() };
}

export function requireStore(): ProjectStore {
  if (!store) throw new Error("Kein Projekt geöffnet");
  return store;
}

/**
 * Nach jedem `await` in einem IPC-Aufruf: Ist das Projekt von vorher noch offen? Sonst endet der Aufruf mit einer
 * verständlichen Meldung, statt in ein geschlossenes oder fremdes Projekt zu schreiben.
 */
export function stillOpen(s: ProjectStore): ProjectStore {
  if (store !== s) throw new Error("Das Projekt wurde inzwischen gewechselt");
  return s;
}

export function bindingOpts(): { nativeBinding?: string } {
  const binding = nativeBinding();
  return binding ? { nativeBinding: binding } : {};
}

/** Projekt schließen; vorher Änderungen seit der letzten automatischen Sicherung sichern. */
export function closeStore(): void {
  if (!store) return;
  // Eine laufende Analyse oder Ausgabe liest und schreibt dieses Projekt; sie endet mit dem Projekt.
  for (const ctrl of analyzing.values()) ctrl.abort();
  abortExport();
  autoBackup.detach();
  store.close();
  store = null;
}

/**
 * Projekt öffnen oder anlegen. Eine vorhandene Datei wird vorher geprüft (vollständig, nicht beschädigt, ein
 * Feldspur-Projekt); scheitert das, bleibt das bisherige Projekt offen. `fresh`: nichts automatisch sichern.
 */
export function openStore(path: string, create: boolean, fresh = create): ProjectInfo | null {
  if (exportRunning()) throw new Error("Während einer Ausgabe lässt sich kein anderes Projekt öffnen.");
  const opts = bindingOpts();
  if (!create) {
    const check = checkProjectFile(path, opts);
    if (!check.ok) {
      failedPath = path;
      const hint = listBackups(path).length
        ? ` Sicherungen dieses Projekts liegen im Ordner „${basename(backupDir(path))}“ daneben; mit „Sicherung als Kopie öffnen…“ lässt sich eine davon öffnen.`
        : "";
      throw new Error(`„${basename(path)}“ lässt sich nicht öffnen. ${check.problem}${hint}`);
    }
  }
  // Erst das neue Projekt öffnen, dann das alte schließen: Scheitert das Öffnen (etwa weil sich vor einer Umstellung
  // keine Sicherung anlegen lässt), bleibt das bisherige Projekt nutzbar.
  const next = create
    ? ProjectStore.create(path, { name: basename(path).replace(/\.feldspur$/, ""), ...opts })
    : ProjectStore.open(path, { ...opts, backupBeforeMigration: true });
  closeStore();
  store = next;
  failedPath = null;
  autoBackup.attach(store, { fresh });
  const info = projectInfo()!;
  win?.setTitle(`Feldspur · ${info.name}`);
  rememberProject(info.path, info.name);
  return info;
}
