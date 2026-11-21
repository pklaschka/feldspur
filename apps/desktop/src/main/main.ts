import { existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import {
  backupDir,
  checkProjectFile,
  copyProjectFile,
  listBackups,
  nextBackupPath,
  ProjectStore,
  fileStamp,
  type TouchedRow,
} from "@feldspur/core";
import {
  analyzeSession,
  applyImport,
  applyReread,
  rereadChanges,
  rereadSource,
  type RereadSource,
  measureSource,
  refineAlignment,
  parseTranscript,
  readPeaks,
  ScanCache,
  scanPaths,
  setToolPaths,
  TRANSCRIPT_EXTENSIONS,
  type ScanProgress,
} from "@feldspur/media";
import {
  IPC,
  MEDIA_SCHEME,
  type AnchorInput,
  type LevelInput,
  type PageNumberingInput,
  type ContextDetails,
  type DiaryPatch,
  type Region,
  type ImportResult,
  type TimeInput,
  type NewSessionInput,
  type SessionPatch,
  type TranscriptPatch,
  type HistoryResult,
  type HistoryTarget,
  type SessionView,
  type SourceNoteInput,
  type ProjectInfo,
} from "../shared/api.ts";
import { changeLogCsv } from "./changelog.ts";
import {
  contextFind,
  contextName,
  contextPosition,
  createContextText,
  moveContext,
  setContext,
  setContextDetails,
  setEntryRefs,
  sortContextByPage,
} from "./context.ts";
import { addRegion, createEntry, deleteEntry, moveRegion, patchEntry, removeRegion, setRegionPage } from "./diary.ts";
import {
  addManualAnchor,
  addTimeEvidence,
  clearDeviceChecks,
  confirmAnchors,
  confirmPlacement,
  decideMany,
  decidePlacement,
  parseClockNear,
  proposalsToConfirm,
  sessionSpan,
  kindHolds,
  kindName,
  type DecideInput,
  removeEvidence,
  replaceAnchor,
  setLevel,
  setPageNumbering,
  toggleEvidence,
} from "./edits.ts";
import {
  cancelExport,
  exportRunning,
  exportingSession,
  exportStatus,
  montagePlan,
  previewExport,
  registerOverlayBridge,
  runExport,
} from "./export.ts";
import { fileResponse } from "./media-response.ts";
import { updateSessionDetails } from "./session.ts";
import {
  linkFollowUps,
  mergeDevices,
  moveSource,
  removeSource,
  setFollows,
  setPartOf,
  setSourceKind,
} from "./sources.ts";
import { resolveToolPaths } from "./tools.ts";
import { addNote, deleteNote, updateNote } from "./notes.ts";
import { addLine, deleteLine, importLines, updateLine } from "./transcript.ts";
import { addEpisodeAround, moveEpisodeEdge, timelineEnvelopes } from "./episodes.ts";
import { buildSessionView } from "./view.ts";
import { checkOriginals, relinkDuplicates, relinkFile, searchOriginals, unreachableForAnalysis } from "./originals.ts";
import { forgetProject, recentProjects, rememberProject } from "./recent.ts";
import { AUTO_BACKUP_CHECK_MS, AutoBackup } from "./backup.ts";

let store: ProjectStore | null = null;
/** Laufendes Einsammeln je Einsatz, zum Abbrechen. */
const importing = new Map<string, AbortController>();
/** Einsätze, deren Tonspuren gerade analysiert werden, zum Abbrechen. */
const analyzing = new Map<string, AbortController>();
/** Schon vollständig gelesene Dateien: Ein zweiter Versuch nach einem Abbruch muss sie nicht erneut lesen. */
const scanCache = new ScanCache();
let win: BrowserWindow | null = null;
const autoBackup = new AutoBackup();
/** Zuletzt gescheitertes Öffnen: dort sucht „Sicherung als Kopie öffnen…“ zuerst nach Sicherungen. */
let lastFailedPath: string | null = null;

/** Die gebündelte App lädt better-sqlite3 über eine Datei neben der App (siehe scripts/fetch-electron-sqlite.mjs). */
function nativeBinding(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? "", "native", "better_sqlite3.node"),
    join(app.getAppPath(), "native", `${process.platform}-${process.arch}`, "better_sqlite3.node"),
  ];
  return candidates.find((p) => existsSync(p));
}

/** App-Symbol fürs Fenster (Linux/Windows) und „Über Feldspur“: im Paket unter resources/, beim Entwickeln aus packaging/. */
function appIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? "", "icon.png"),
    join(app.getAppPath(), "..", "..", "packaging", "icon.png"),
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

function bindingOpts(): { nativeBinding?: string } {
  const binding = nativeBinding();
  return binding ? { nativeBinding: binding } : {};
}

/** Projekt schließen; vorher Änderungen seit der letzten automatischen Sicherung sichern. */
function closeStore(): void {
  if (!store) return;
  // Eine laufende Analyse schreibt in dieses Projekt; sie endet mit dem Projekt.
  for (const ctrl of analyzing.values()) ctrl.abort();
  autoBackup.detach();
  store.close();
  store = null;
}

/**
 * Projekt öffnen oder anlegen. Eine vorhandene Datei wird vorher geprüft (vollständig, nicht beschädigt, ein
 * Feldspur-Projekt); scheitert das, bleibt das bisherige Projekt offen. `fresh`: nichts automatisch sichern.
 */
function openStore(path: string, create: boolean, fresh = create): ProjectInfo | null {
  if (exportRunning()) throw new Error("Während einer Ausgabe lässt sich kein anderes Projekt öffnen.");
  const opts = bindingOpts();
  if (!create) {
    const check = checkProjectFile(path, opts);
    if (!check.ok) {
      lastFailedPath = path;
      const hint = listBackups(path).length
        ? ` Sicherungen dieses Projekts liegen im Ordner „${basename(backupDir(path))}“ daneben; mit „Sicherung als Kopie öffnen…“ lässt sich eine davon öffnen.`
        : "";
      throw new Error(`„${basename(path)}“ lässt sich nicht öffnen. ${check.problem}${hint}`);
    }
  }
  closeStore();
  store = create
    ? ProjectStore.create(path, { name: basename(path).replace(/\.feldspur$/, ""), ...opts })
    : ProjectStore.open(path, { ...opts, backupBeforeMigration: true });
  lastFailedPath = null;
  autoBackup.attach(store, { fresh });
  const info = projectInfo()!;
  win?.setTitle(`Feldspur · ${info.name}`);
  rememberProject(info.path, info.name);
  return info;
}

type ExportRequest = {
  video: boolean;
  resolve?: boolean;
  mixAudio?: boolean;
  realtime?: boolean;
  deviceTracks?: boolean;
  viewer?: boolean;
  dir?: string;
  reuseDir?: boolean;
  acceptOriginals?: boolean;
};

/**
 * IPC-Aufruf, der Daten ändert, als ein Schritt für Rückgängig. Die Ansicht wird im selben Schritt gebaut; das
 * stört nicht, weil sie nichts schreibt.
 */
function undoable<A extends unknown[], R>(
  channel: string,
  /** Beschriftung im Verlauf; als Funktion, wenn sie die betroffene Quelle nennen soll (vor der Änderung gelesen). */
  label: string | ((s: ProjectStore, ...args: A) => string),
  handler: (e: Electron.IpcMainInvokeEvent, ...args: A) => R,
): void {
  ipcMain.handle(channel, (e, ...args) => {
    const s = requireStore();
    const text = typeof label === "string" ? label : label(s, ...(args as A));
    return s.history.record(text, () => handler(e, ...(args as A)));
  });
}

/** „F-003, Dateiname“ für Beschriftungen im Verlauf. */
function evidenceLabel(s: ProjectStore, evidenceId: string): { source: string; kind: string; checked: boolean } {
  const ev = s.getEvidence(evidenceId);
  return { source: s.getSource(ev.sourceId).label, kind: kindName(ev.kind), checked: ev.kind === "checked" };
}

/** Rückgängig/Wiederholen ausführen und das Ergebnis für die Oberfläche zusammenstellen. */
function historyStep(redo: boolean, sessionId: string | null): HistoryResult {
  const s = requireStore();
  const label = redo ? s.history.redo() : s.history.undo();
  const alive = sessionId && s.listSessions().some((x) => x.id === sessionId);
  const view = alive ? buildSessionView(s, sessionId) : null;
  return {
    label,
    project: projectInfo()!,
    view,
    target: label && view ? historyTarget(s.history.lastTouched(), view) : null,
  };
}

/** Die erste geänderte Zeile, die sich in der Oberfläche zeigen lässt (Mitschrift, Notiz, Tagebuch, Quelle). */
function historyTarget(rows: TouchedRow[], view: SessionView): HistoryTarget | null {
  const known = new Set(view.rows.map((r) => r.id));
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  for (const { table, row } of rows) {
    const sourceId = str(row.source_id);
    if (table === "transcript_lines" && sourceId && known.has(sourceId))
      return { kind: "line", sourceId, atMs: Number(row.at_ms) };
    if (table === "source_notes" && sourceId && known.has(sourceId))
      return { kind: "note", sourceId, atMs: row.from_ms == null ? undefined : Number(row.from_ms) };
    if (table === "diary_entries") {
      let regions: { sourceId?: string }[] = [];
      try {
        regions = JSON.parse(String(row.regions)) as { sourceId?: string }[];
      } catch {
        // Ohne lesbare Bereiche gibt es nichts zu zeigen.
      }
      const sid = regions[0]?.sourceId;
      if (sid && known.has(sid)) return { kind: "diary", sourceId: sid };
    }
  }
  // Sonst die Quelle, um die es ging (Zeitbelege, Anker, Episoden-Anpassungen, die Quelle selbst).
  for (const { table, row } of rows) {
    const sid = table === "sources" ? str(row.id) : (str(row.source_id) ?? str(row.a_source_id));
    if (sid && known.has(sid)) return { kind: "source", sourceId: sid };
  }
  return null;
}

function registerIpc(): void {
  ipcMain.handle(IPC.undo, (_e, sessionId: string | null) => historyStep(false, sessionId));
  ipcMain.handle(IPC.redo, (_e, sessionId: string | null) => historyStep(true, sessionId));
  undoable(
    IPC.moveEpisodeEdge,
    "Episodengrenze verschoben",
    (_e, id: string, edge: "start" | "end", from: number, to: number) => {
      const s = requireStore();
      moveEpisodeEdge(s, id, edge, from, to);
      return buildSessionView(s, id);
    },
  );
  undoable(IPC.addEpisodeAround, "Mini-Episode angelegt", (_e, id: string, atMs: number) => {
    const s = requireStore();
    addEpisodeAround(s, id, atMs);
    return buildSessionView(s, id);
  });
  undoable(IPC.resetEpisodes, "Episoden zurückgesetzt", (_e, id: string) => {
    const s = requireStore();
    s.clearEpisodeEdits(id);
    return buildSessionView(s, id);
  });
  ipcMain.handle(IPC.envelopes, (_e, id: string) => timelineEnvelopes(requireStore(), id));
  ipcMain.handle(IPC.historyState, () => (store ? store.history.state() : { undo: null, redo: null, serial: 0 }));
  ipcMain.handle(IPC.changeLog, (_e, opts: { limit?: number; before?: number }) =>
    store ? store.history.changeLog(opts) : [],
  );
  ipcMain.handle(IPC.exportChangeLog, async () => {
    const s = requireStore();
    const info = projectInfo()!;
    const r = await dialog.showSaveDialog(win!, {
      title: "Änderungsprotokoll speichern",
      defaultPath: join(dirname(info.path), `${basename(info.path, ".feldspur")}_Aenderungsprotokoll.csv`),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, changeLogCsv(s.history), "utf8");
    return r.filePath;
  });
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

  ipcMain.handle(IPC.backups, () => autoBackup.overview());
  ipcMain.handle(IPC.createBackup, async () => {
    const s = requireStore();
    const dir = backupDir(s.path);
    mkdirSync(dir, { recursive: true });
    const r = await dialog.showSaveDialog(win!, {
      title: "Sicherung erstellen",
      defaultPath: nextBackupPath(s.path, "manuell"),
      filters: [{ name: "Feldspur-Projekt", extensions: ["feldspur"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const dest = r.filePath.endsWith(".feldspur") ? r.filePath : `${r.filePath}.feldspur`;
    s.backupTo(dest);
    return dest;
  });
  ipcMain.handle(IPC.openBackupCopy, async (_e, given?: string) => {
    let src = given;
    if (!src) {
      const near = lastFailedPath ?? store?.path;
      const dir = near ? backupDir(near) : undefined;
      const r = await dialog.showOpenDialog(win!, {
        title: "Sicherung als Kopie öffnen",
        defaultPath: dir && existsSync(dir) ? dir : near ? dirname(near) : undefined,
        properties: ["openFile"],
        filters: [{ name: "Feldspur-Projekt", extensions: ["feldspur"] }],
      });
      src = r.filePaths[0];
      if (r.canceled || !src) return null;
    }
    const check = checkProjectFile(src, bindingOpts());
    if (!check.ok) throw new Error(`Diese Sicherung lässt sich nicht öffnen. ${check.problem}`);
    // Vorschlag: neben dem Original (falls bekannt), mit dem Stand der Sicherung im Namen.
    const original = lastFailedPath ?? store?.path;
    const listed = original ? listBackups(original).find((b) => b.path === src) : undefined;
    const stamp = fileStamp(listed ? new Date(listed.createdAt) : statSync(src).mtime);
    const base = (original ? basename(original) : basename(src))
      .replace(/\.feldspur$/i, "")
      .replace(/_\d{4}-\d\d-\d\d_.*$/, "");
    const r = await dialog.showSaveDialog(win!, {
      title: "Wiederhergestellte Kopie speichern unter",
      defaultPath: join(original ? dirname(original) : dirname(dirname(src)), `${base} (Stand ${stamp}).feldspur`),
      filters: [{ name: "Feldspur-Projekt", extensions: ["feldspur"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const dest = r.filePath.endsWith(".feldspur") ? r.filePath : `${r.filePath}.feldspur`;
    if (store && resolve(dest) === resolve(store.path))
      throw new Error("Die Kopie darf nicht das offene Projekt ersetzen. Bitte einen anderen Namen wählen.");
    if (resolve(dest) === resolve(src)) throw new Error("Die Kopie braucht einen anderen Namen als die Sicherung.");
    if (exportRunning()) throw new Error("Während einer Ausgabe lässt sich kein anderes Projekt öffnen.");
    copyProjectFile(src, dest, bindingOpts());
    const info = openStore(dest, false, true);
    // Woher die Kopie stammt, steht in der Projektdatei und als Schritt im Änderungsprotokoll.
    const s = requireStore();
    s.history.record("Aus Sicherung wiederhergestellt", () => {
      s.setMeta("restored_from", basename(src));
      s.setMeta("restored_at", new Date().toISOString());
    });
    s.history.clear();
    return info;
  });
  ipcMain.handle(IPC.showBackupFolder, async () => {
    const dir = backupDir(requireStore().path);
    mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });

  undoable(IPC.createSession, "Einsatz angelegt", (_e, input: NewSessionInput) => {
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

  ipcMain.handle(IPC.cancelImport, (_e, sessionId: string) => {
    importing.get(sessionId)?.abort();
  });
  ipcMain.handle(IPC.importPaths, async (e, sessionId: string, paths: string[]): Promise<ImportResult> => {
    const s = requireStore();
    if (importing.has(sessionId)) throw new Error("In diesen Einsatz wird schon eingesammelt.");
    const ctrl = new AbortController();
    importing.set(sessionId, ctrl);
    const skipped: { fileName: string; message: string }[] = [];
    let last: ScanProgress | null = null;
    let plan;
    try {
      plan = await scanPaths(paths, {
        signal: ctrl.signal,
        cache: scanCache,
        onSkipped: (path, message) => skipped.push({ fileName: basename(path), message }),
        onProgress: (p) => {
          last = p;
          if (!e.sender.isDestroyed()) e.sender.send(IPC.importProgress, { sessionId, ...p });
        },
      });
    } catch (err) {
      // Abgebrochen: Es wurde nichts ins Projekt geschrieben; Gelesenes merkt sich scanCache für den nächsten Versuch.
      if (ctrl.signal.aborted) {
        const p = last as ScanProgress | null;
        return { cancelled: { read: p?.phase === "reading" ? p.done : 0, total: p?.total ?? 0 } };
      }
      throw err;
    } finally {
      importing.delete(sessionId);
    }
    if (store !== s) throw new Error("Das Projekt wurde während des Einsammelns gewechselt. Nichts übernommen.");
    const res = applyImport(s, sessionId, plan);
    linkFollowUps(s, sessionId);
    // Wer verschobene Originale erneut einsammelt, verknüpft sie damit neu (gleiche Prüfsumme = gleiche Datei).
    const relinked = relinkDuplicates(
      s,
      res.duplicates.map((d) => ({ path: d.candidate.path, existing: d.existing })),
    );
    return {
      added: res.sources.length,
      duplicates: res.duplicates.length - relinked,
      relinked,
      warnings: [...skipped, ...plan.flatMap((c) => c.warnings.map((message) => ({ fileName: c.fileName, message })))],
      view: buildSessionView(s, sessionId),
    };
  });

  undoable(IPC.renameDevice, "Gerät umbenannt", (_e, deviceId: string, label: string) => {
    const s = requireStore();
    const d = s.updateDevice(deviceId, { label: label.trim() || s.getDevice(deviceId).label });
    return buildSessionView(s, d.sessionId);
  });

  undoable(IPC.updateSession, "Einsatzdaten geändert", (_e, sessionId: string, patch: SessionPatch) => {
    const s = requireStore();
    updateSessionDetails(s, sessionId, patch);
    return { view: buildSessionView(s, sessionId), project: projectInfo()! };
  });
  undoable(IPC.deleteSession, "Einsatz gelöscht", (_e, sessionId: string) => {
    const s = requireStore();
    if (importing.has(sessionId))
      throw new Error("In diesen Einsatz wird gerade eingesammelt. Bitte warten oder abbrechen, dann löschen.");
    if (exportingSession() === sessionId)
      throw new Error("Für diesen Einsatz läuft gerade eine Ausgabe. Bitte warten oder abbrechen, dann löschen.");
    if (analyzing.has(sessionId))
      throw new Error("Die Tonspuren dieses Einsatzes werden gerade analysiert. Bitte warten, dann löschen.");
    s.deleteSession(sessionId);
    return projectInfo()!;
  });
  undoable(IPC.removeSource, "Quelle entfernt", (_e, sourceId: string) => {
    const s = requireStore();
    return buildSessionView(s, removeSource(s, sourceId));
  });
  undoable(IPC.moveSource, "Quelle verschoben", (_e, sourceId: string, target: string | { newLabel: string }) => {
    const s = requireStore();
    return buildSessionView(s, moveSource(s, sourceId, target));
  });
  undoable(IPC.mergeDevices, "Geräte zusammengeführt", (_e, fromId: string, intoId: string) => {
    const s = requireStore();
    return buildSessionView(s, mergeDevices(s, fromId, intoId));
  });
  undoable(IPC.setPartOf, "Seite zugeordnet", (_e, sourceId: string, mainId: string | null) => {
    const s = requireStore();
    return buildSessionView(s, setPartOf(s, sourceId, mainId));
  });
  undoable(IPC.setSourceKind, "Bildart geändert", (_e, sourceId: string, kind: "diary" | "photo") => {
    const s = requireStore();
    return buildSessionView(s, setSourceKind(s, sourceId, kind));
  });
  undoable(IPC.setFollows, "Folgeaufnahme gesetzt", (_e, sourceId: string, prevId: string | null) => {
    const s = requireStore();
    return buildSessionView(s, setFollows(s, sourceId, prevId));
  });

  undoable(
    IPC.addTranscriptLine,
    "Zeile angelegt",
    (_e, sourceId: string, line: { atMs: number; speaker: string; text: string }) => {
      const s = requireStore();
      const l = addLine(s, sourceId, line);
      return { view: buildSessionView(s, s.getSource(sourceId).sessionId), lineId: l.id };
    },
  );
  undoable(IPC.updateTranscriptLine, "Zeile geändert", (_e, lineId: string, patch: TranscriptPatch) => {
    const s = requireStore();
    return buildSessionView(s, updateLine(s, lineId, patch));
  });
  undoable(IPC.deleteTranscriptLine, "Zeile gelöscht", (_e, lineId: string) => {
    const s = requireStore();
    return buildSessionView(s, deleteLine(s, lineId));
  });

  undoable(IPC.addSourceNote, "Notiz angelegt", (_e, sourceId: string, note: SourceNoteInput) => {
    const s = requireStore();
    return buildSessionView(s, addNote(s, sourceId, note));
  });
  undoable(IPC.updateSourceNote, "Notiz geändert", (_e, noteId: string, patch: SourceNoteInput) => {
    const s = requireStore();
    return buildSessionView(s, updateNote(s, noteId, patch));
  });
  undoable(IPC.deleteSourceNote, "Notiz gelöscht", (_e, noteId: string) => {
    const s = requireStore();
    return buildSessionView(s, deleteNote(s, noteId));
  });
  ipcMain.handle(IPC.waveformPeaks, (_e, sourceId: string, fromMs: number, toMs: number, buckets: number) => {
    const src = requireStore().getSource(sourceId);
    if (src.kind !== "audio" && src.kind !== "video") throw new Error(`${src.label} hat keine Tonspur`);
    return readPeaks(src.originalPath, fromMs, toMs, buckets);
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
      // Nur der schreibende Teil ist ein Schritt für Rückgängig; Dateidialog und Parsen liegen davor.
      const label = opts.mode === "replace" ? "Mitschrift ersetzt" : "Transkript importiert";
      const r = s.history.record(label, () => importLines(s, sourceId, lines, opts.mode));
      return { view: buildSessionView(s, r.sessionId), count: r.count, dropped: r.dropped };
    },
  );
  ipcMain.handle(IPC.previewExport, (_e, sessionId: string, realtime?: boolean) =>
    previewExport(requireStore(), sessionId, realtime),
  );
  ipcMain.handle(IPC.exportStatus, (_e, sessionId: string, opts: ExportRequest) =>
    exportStatus(requireStore(), sessionId, opts),
  );
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
      const r = await dialog.showOpenDialog(win!, {
        title: "Wohin ausgeben?",
        buttonLabel: "Hier ausgeben",
        defaultPath: lastParent,
        properties: ["openDirectory", "createDirectory"],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      parent = r.filePaths[0];
    }
    return runExport(s, e.sender, sessionId, parent, opts);
  });
  ipcMain.handle(IPC.cancelExport, (_e, sessionId: string) => cancelExport(sessionId));
  ipcMain.handle(IPC.checkOriginals, (e, sessionId: string, video: boolean) =>
    checkOriginals(requireStore(), sessionId, {
      video,
      onProgress: (done, total, fileName) =>
        e.sender.send(IPC.originalsProgress, { sessionId, phase: "prüfen", done, total, fileName }),
    }),
  );
  ipcMain.handle(IPC.searchOriginals, async (e, sessionId: string) => {
    const s = requireStore();
    const r = await dialog.showOpenDialog(win!, {
      title: "Ordner mit den Originalen wählen",
      buttonLabel: "Hier suchen",
      properties: ["openDirectory"],
    });
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return null;
    const result = await searchOriginals(s, sessionId, dir, (done, phase, fileName) =>
      e.sender.send(IPC.originalsProgress, { sessionId, phase, done, total: 0, fileName }),
    );
    return { view: buildSessionView(s, sessionId), result };
  });
  ipcMain.handle(IPC.relinkOriginal, async (_e, sourceId: string) => {
    const s = requireStore();
    const src = s.getSource(sourceId);
    const r = await dialog.showOpenDialog(win!, {
      title: `Originaldatei für ${src.label} (${src.fileName}) wählen`,
      defaultPath: existsSync(dirname(src.originalPath)) ? dirname(src.originalPath) : undefined,
      properties: ["openFile"],
    });
    const path = r.filePaths[0];
    if (r.canceled || !path) return null;
    return buildSessionView(s, await relinkFile(s, sourceId, path));
  });
  ipcMain.handle(IPC.showInFolder, (_e, path: string) => shell.showItemInFolder(path));

  undoable(IPC.setReference, "Referenzuhr gewählt", (_e, deviceId: string) => {
    const s = requireStore();
    const d = s.setReferenceDevice(deviceId);
    return buildSessionView(s, d.sessionId);
  });

  ipcMain.handle(IPC.rereadDevice, async (_e, deviceId: string) => {
    const s = requireStore();
    const device = s.getDevice(deviceId);
    const sources = s.listSources(device.sessionId).filter((x) => x.deviceId === deviceId);
    const read: RereadSource[] = [];
    const missing: string[] = [];
    // Erst alles lesen (dauert), dann in einem Schritt übernehmen: der lässt sich rückgängig machen.
    for (const src of sources) {
      if (!existsSync(src.originalPath)) {
        missing.push(src.label);
        continue;
      }
      try {
        read.push(await rereadSource(src));
      } catch {
        missing.push(src.label);
      }
    }
    const store = requireStore();
    if (store !== s) throw new Error("Das Projekt wurde inzwischen gewechselt");
    // Erst prüfen, ob sich etwas ändert: ein leerer Schritt im Verlauf hilft niemandem.
    const changed = rereadChanges(s, device.sessionId, read)
      ? s.history.record(`Zeitbelege neu gelesen: ${device.label}`, () => applyReread(s, device.sessionId, read))
      : 0;
    return { view: buildSessionView(s, device.sessionId), changed, missing };
  });
  undoable(
    IPC.clearDeviceChecks,
    (s, deviceId: string) => `Bestätigungen entfernt: ${s.getDevice(deviceId).label}`,
    (_e, deviceId: string) => {
      const s = requireStore();
      return buildSessionView(s, clearDeviceChecks(s, deviceId));
    },
  );
  undoable(IPC.setDeviceTimeZone, "Zeitzone geändert", (_e, deviceId: string, timeZone: string | null) => {
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
  undoable(
    IPC.setDeviceUtc,
    (s, deviceId: string, utc: boolean) =>
      `Zeitstempel von ${s.getDevice(deviceId).label} als ${utc ? "UTC" : "Ortszeit"} gelesen`,
    (_e, deviceId: string, utc: boolean) => {
      const s = requireStore();
      const d = s.updateDevice(deviceId, { timestampsAreUtc: utc });
      return buildSessionView(s, d.sessionId);
    },
  );

  undoable(IPC.setDiaryNote, "Randnotiz eingetragen", (_e, sourceId: string, clock: string) => {
    const s = requireStore();
    return buildSessionView(s, setDiaryNote(s, sourceId, clock));
  });

  ipcMain.handle(IPC.cancelAnalyze, (_e, sessionId: string) => {
    analyzing.get(sessionId)?.abort();
  });
  ipcMain.handle(IPC.analyze, async (e, sessionId: string) => {
    const s = requireStore();
    if (analyzing.has(sessionId)) throw new Error("Die Tonspuren dieses Einsatzes werden schon analysiert.");
    const ctrl = new AbortController();
    analyzing.set(sessionId, ctrl);
    let r;
    try {
      r = await analyzeSession(s, sessionId, {
        signal: ctrl.signal,
        skip: unreachableForAnalysis(s, sessionId),
        onProgress: (done, total, fileName) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.progress, { done, total, fileName });
        },
      });
    } catch (err) {
      if (!ctrl.signal.aborted) throw err;
      if (store !== s)
        throw new Error("Das Projekt wurde während der Analyse gewechselt. Die Analyse wurde abgebrochen.");
      // Abgebrochen: Schon analysierte Tonspuren bleiben gespeichert und werden beim nächsten Mal übersprungen.
      return { view: buildSessionView(s, sessionId), analyzed: 0, failed: [], cancelled: true };
    } finally {
      analyzing.delete(sessionId);
    }
    return {
      view: buildSessionView(s, sessionId),
      analyzed: r.analyzed,
      failed: r.failed.map((f) => `${f.fileName}: ${f.message}`),
    };
  });

  undoable(IPC.confirmAnchor, "Vorschlag übernommen", (_e, anchorId: string) => {
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
  undoable(
    IPC.confirmAnchors,
    (s, sessionId: string, anchorIds: string[]) => {
      const n = proposalsToConfirm(s, sessionId, anchorIds).length;
      return n === 1 ? "Vorschlag übernommen" : `${n} Vorschläge übernommen`;
    },
    (_e, sessionId: string, anchorIds: string[]) => {
      const s = requireStore();
      confirmAnchors(s, sessionId, anchorIds);
      return buildSessionView(s, sessionId);
    },
  );

  undoable(IPC.rejectAnchor, "Anker entfernt", (_e, anchorId: string) => {
    const s = requireStore();
    const a = s.getAnchor(anchorId);
    s.deleteAnchor(anchorId);
    return buildSessionView(s, a.sessionId);
  });

  undoable(
    IPC.confirmPlacement,
    (s, sourceId: string, _startMs: number) => `Lage bestätigt: ${s.getSource(sourceId).label}`,
    (_e, sourceId: string, startMs: number) => {
      const s = requireStore();
      return buildSessionView(s, confirmPlacement(s, sourceId, startMs));
    },
  );
  undoable(
    IPC.decidePlacement,
    (s, input: DecideInput) => {
      const src = s.getSource(input.sourceId).label;
      const kind = input.evidenceId ? s.getEvidence(input.evidenceId) : null;
      const what = kind
        ? kindHolds(kind.kind === "checked" ? (kind.decision?.basisKind ?? "checked") : kind.kind)
        : "Lage passt";
      const again = s
        .listEvidence(s.getSource(input.sourceId).sessionId)
        .some((e) => e.sourceId === input.sourceId && e.kind === "checked" && e.decision);
      return `Widerspruch ${again ? "neu " : ""}entschieden: ${src}, ${what}`;
    },
    (_e, input: DecideInput) => {
      const s = requireStore();
      return buildSessionView(s, decidePlacement(s, input));
    },
  );
  undoable(
    IPC.decideMany,
    (s, input: { sourceIds: string[]; kind: string; reason: string }) => {
      const first = input.sourceIds[0] ? s.getSource(input.sourceIds[0]) : null;
      const dev = first?.deviceId ? ` von ${s.getDevice(first.deviceId).label}` : "";
      return `Widersprüche entschieden: ${input.sourceIds.length} Dateien${dev}, ${kindHolds(input.kind)}`;
    },
    (_e, input: { sourceIds: string[]; kind: string; reason: string }) => {
      const s = requireStore();
      return buildSessionView(s, decideMany(s, input));
    },
  );
  undoable(IPC.addTime, "Uhrzeit eingetragen", (_e, input: TimeInput) => {
    const s = requireStore();
    return buildSessionView(s, addTimeEvidence(s, input));
  });

  undoable(
    IPC.setEvidenceEnabled,
    (s, evidenceId: string, enabled: boolean) => {
      const l = evidenceLabel(s, evidenceId);
      return `Zeitbeleg ${enabled ? "eingeschaltet" : "abgeschaltet"}: ${l.source}, ${l.kind}`;
    },
    (_e, evidenceId: string, enabled: boolean) => {
      const s = requireStore();
      return buildSessionView(s, toggleEvidence(s, evidenceId, enabled));
    },
  );

  undoable(
    IPC.removeEvidence,
    (s, evidenceId: string) => {
      const l = evidenceLabel(s, evidenceId);
      return l.checked ? `Entscheidung zurückgenommen: ${l.source}` : `Zeitbeleg gelöscht: ${l.source}, ${l.kind}`;
    },
    (_e, evidenceId: string) => {
      const s = requireStore();
      return buildSessionView(s, removeEvidence(s, evidenceId));
    },
  );

  undoable(IPC.addAnchor, "Anker gesetzt", (_e, input: AnchorInput) => {
    const s = requireStore();
    return buildSessionView(s, addManualAnchor(s, input));
  });
  undoable(IPC.replaceAnchor, "Anker geändert", (_e, anchorId: string, input: AnchorInput) => {
    const s = requireStore();
    return buildSessionView(s, replaceAnchor(s, anchorId, input));
  });
  ipcMain.handle(
    IPC.alignRefine,
    (_e, i: { aSourceId: string; aAtMs: number; bSourceId: string; bAtMs: number; searchMs: number }) => {
      const s = requireStore();
      return refineAlignment({
        aPath: s.getSource(i.aSourceId).originalPath,
        aAtMs: i.aAtMs,
        bPath: s.getSource(i.bSourceId).originalPath,
        bAtMs: i.bAtMs,
        searchMs: i.searchMs,
      });
    },
  );
  undoable(IPC.setLevel, "Lautstärke geändert", (_e, sourceId: string, input: LevelInput) => {
    const s = requireStore();
    return buildSessionView(s, setLevel(s, sourceId, input));
  });
  undoable(IPC.setPageNumbering, "Seitenzählung geändert", (_e, items: PageNumberingInput[]) => {
    const s = requireStore();
    return buildSessionView(s, setPageNumbering(s, items));
  });
  ipcMain.handle(IPC.measureLevel, async (_e, sourceId: string) => {
    const s = requireStore();
    await measureSource(s, sourceId);
    return buildSessionView(s, s.getSource(sourceId).sessionId);
  });

  undoable(IPC.createDiaryEntry, "Tagebucheintrag angelegt", (_e, sourceId: string, region: Region) => {
    const s = requireStore();
    const r = createEntry(s, sourceId, region);
    return { view: buildSessionView(s, r.sessionId), entryId: r.entry.id };
  });
  undoable(IPC.addDiaryRegion, "Rahmen ergänzt", (_e, entryId: string, sourceId: string, region: Region) => {
    const s = requireStore();
    return buildSessionView(s, addRegion(s, entryId, sourceId, region));
  });
  undoable(IPC.removeDiaryRegion, "Rahmen entfernt", (_e, entryId: string, index: number) => {
    const s = requireStore();
    return buildSessionView(s, removeRegion(s, entryId, index));
  });
  undoable(IPC.moveDiaryRegion, "Rahmen verschoben", (_e, entryId: string, index: number, region: Region) => {
    const s = requireStore();
    return buildSessionView(s, moveRegion(s, entryId, index, region));
  });
  undoable(
    IPC.setDiaryRegionPage,
    "Seitenzahl geändert",
    (_e, entryId: string, index: number, pageNo: number | null) => {
      const s = requireStore();
      return buildSessionView(s, setRegionPage(s, entryId, index, pageNo));
    },
  );
  undoable(IPC.deleteDiaryEntry, "Tagebucheintrag gelöscht", (_e, entryId: string) => {
    const s = requireStore();
    return buildSessionView(s, deleteEntry(s, entryId));
  });
  undoable(IPC.patchDiaryEntry, "Tagebucheintrag geändert", (_e, entryId: string, patch: DiaryPatch) => {
    const s = requireStore();
    return buildSessionView(s, patchEntry(s, entryId, patch));
  });

  // Kontext (Issue #108): Beschriftungen nennen das Stück, damit das Änderungsprotokoll die Entscheidung belegt.
  undoable(
    IPC.setContext,
    (s, key: string, on: boolean) =>
      `${on ? "Als Kontext geführt" : "Zurück in die Chronologie"}: ${contextFind(s, key)}`,
    (_e, key: string, on: boolean) => {
      const s = requireStore();
      return buildSessionView(s, setContext(s, key, on));
    },
  );
  undoable(
    IPC.setContextDetails,
    (s, key: string, _details: ContextDetails) => `Kontext geändert: ${contextName(s, key)}`,
    (_e, key: string, details: ContextDetails) => {
      const s = requireStore();
      return buildSessionView(s, setContextDetails(s, key, details));
    },
  );
  undoable(
    IPC.moveContext,
    (s, key: string, position: number) =>
      `Kontext umsortiert: ${contextName(s, key)} von Stelle ${contextPosition(s, key)} auf ${position}`,
    (_e, key: string, position: number) => {
      const s = requireStore();
      return buildSessionView(s, moveContext(s, key, position));
    },
  );
  undoable(IPC.sortContextByPage, "Kontext nach Seite geordnet", (_e, sessionId: string) => {
    const s = requireStore();
    return buildSessionView(s, sortContextByPage(s, sessionId));
  });
  undoable(
    IPC.setEntryRefs,
    (s, entryId: string, refs: string[]) => {
      const before = s.getDiaryEntry(entryId).contextRefs;
      const added = refs.filter((k) => !before.includes(k));
      const removed = before.filter((k) => !refs.includes(k));
      const name = (k: string) => {
        try {
          return contextName(s, k);
        } catch {
          return "?";
        }
      };
      if (added.length === 1 && !removed.length) return `Verweis gesetzt: → ${name(added[0]!)}`;
      if (removed.length === 1 && !added.length) return `Verweis entfernt: → ${name(removed[0]!)}`;
      return "Verweise geändert";
    },
    (_e, entryId: string, refs: string[]) => {
      const s = requireStore();
      return buildSessionView(s, setEntryRefs(s, entryId, refs));
    },
  );
  undoable(
    IPC.createContextText,
    "Kontext als Text angelegt",
    (_e, sessionId: string, input: { title: string; text: string }) => {
      const s = requireStore();
      const id = createContextText(s, sessionId, input);
      return { view: buildSessionView(s, sessionId), key: `entry:${id}` };
    },
  );

  undoable(IPC.setDeviceOffset, "Uhrabweichung geändert", (_e, deviceId: string, offsetMs: number | null) => {
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
  const notedAtMs = clock.trim()
    ? parseClockNear(session.date, clock, sessionSpan(s, session.id), { seconds: false })
    : null;
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
    icon: appIcon(),
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
  win?.webContents.reload();
});

/** Fehler beim Öffnen außerhalb der Oberfläche (Doppelklick, „Öffnen mit“) als Meldung zeigen. */
function showOpenError(detail: string): void {
  const opts = { type: "error" as const, message: "Projekt lässt sich nicht öffnen", detail };
  void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
}

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
  win?.webContents.reload();
});

app.on("window-all-closed", () => {
  closeStore();
  app.quit();
});
