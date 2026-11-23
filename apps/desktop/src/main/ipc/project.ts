/**
 * IPC-Aufrufe zum Projekt: öffnen und anlegen, Rückgängig und Verlauf, Projektübersicht, Sicherungen, Zitieren,
 * Zwischenablage.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { clipboard, ClipboardItem, dialog, ipcMain, shell } from "electron";
import {
  backupDir,
  checkProjectFile,
  copyProjectFile,
  listBackups,
  nextBackupPath,
  fileStamp,
  type TouchedRow,
} from "@feldspur/core";
import { fieldCalendarSvg, type CalendarDay } from "@feldspur/media";
import { IPC, type HistoryResult, type HistoryTarget, type SessionView } from "../../shared/api.ts";
import { changeLogCsv } from "../changelog.ts";
import { exportRunning, projectOverview } from "../export.ts";
import { buildSessionView } from "../view.ts";
import { forgetProject, recentProjects } from "../recent.ts";
import { cancelCitationLookup, citationInfo, lookupCitationDoi } from "../citation.ts";
import { isCitationLink } from "../../shared/citation.ts";
import {
  autoBackup,
  bindingOpts,
  currentStore,
  lastFailedPath,
  openStore,
  parentWindow,
  projectInfo,
  requireStore,
  stillOpen,
} from "../state.ts";

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

export function registerProjectIpc(): void {
  ipcMain.handle(IPC.undo, (_e, sessionId: string | null) => historyStep(false, sessionId));
  ipcMain.handle(IPC.redo, (_e, sessionId: string | null) => historyStep(true, sessionId));

  ipcMain.handle(IPC.historyState, () => currentStore()?.history.state() ?? { undo: null, redo: null, serial: 0 });
  ipcMain.handle(
    IPC.changeLog,
    (_e, opts: { limit?: number; before?: number }) => currentStore()?.history.changeLog(opts) ?? [],
  );
  ipcMain.handle(IPC.exportChangeLog, async () => {
    const s = requireStore();
    const info = projectInfo()!;
    const r = await dialog.showSaveDialog(parentWindow(), {
      title: "Änderungsprotokoll speichern",
      defaultPath: join(dirname(info.path), `${basename(info.path, ".feldspur")}_Aenderungsprotokoll.csv`),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, changeLogCsv(stillOpen(s).history), "utf8");
    return r.filePath;
  });
  ipcMain.handle(IPC.currentProject, () => projectInfo());

  ipcMain.handle(IPC.newProject, async () => {
    const r = await dialog.showSaveDialog(parentWindow(), {
      title: "Neues Feldspur-Projekt",
      defaultPath: "Feldforschung.feldspur",
      filters: [{ name: "Feldspur-Projekt", extensions: ["feldspur"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const path = r.filePath.endsWith(".feldspur") ? r.filePath : `${r.filePath}.feldspur`;
    return openStore(path, !existsSync(path));
  });

  ipcMain.handle(IPC.openProject, async () => {
    const r = await dialog.showOpenDialog(parentWindow(), {
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

  ipcMain.handle(IPC.projectOverview, () => ({
    sessions: projectOverview(requireStore()),
    citation: citationInfo(),
  }));
  ipcMain.handle(IPC.saveFieldCalendar, async (_e, days: CalendarDay[]) => {
    if (!Array.isArray(days) || !days.length) return null;
    const info = projectInfo()!;
    const r = await dialog.showSaveDialog(parentWindow(), {
      title: "Feldkalender speichern",
      defaultPath: join(dirname(info.path), `${basename(info.path, ".feldspur")}_Feldkalender.svg`),
      filters: [{ name: "SVG-Grafik", extensions: ["svg"] }],
    });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, fieldCalendarSvg(days), "utf8");
    return r.filePath;
  });

  ipcMain.handle(IPC.backups, () => autoBackup.overview());
  ipcMain.handle(IPC.citationInfo, () => citationInfo());
  ipcMain.handle(IPC.lookupCitationDoi, () => lookupCitationDoi());
  ipcMain.handle(IPC.cancelCitationLookup, () => cancelCitationLookup());
  ipcMain.handle(IPC.copyText, (_e, text: string) => clipboard.writeText(String(text)));
  ipcMain.handle(IPC.copyTable, (_e, html: string, text: string) =>
    clipboard.write([new ClipboardItem({ "text/html": String(html), "text/plain": String(text) })]),
  );
  ipcMain.handle(IPC.openCitationLink, async (_e, url: string) => {
    if (isCitationLink(String(url))) await shell.openExternal(String(url));
  });
  ipcMain.handle(IPC.createBackup, async () => {
    const s = requireStore();
    const dir = backupDir(s.path);
    mkdirSync(dir, { recursive: true });
    const r = await dialog.showSaveDialog(parentWindow(), {
      title: "Sicherung erstellen",
      defaultPath: nextBackupPath(s.path, "manuell"),
      filters: [{ name: "Feldspur-Projekt", extensions: ["feldspur"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const dest = r.filePath.endsWith(".feldspur") ? r.filePath : `${r.filePath}.feldspur`;
    stillOpen(s).backupTo(dest);
    return dest;
  });
  ipcMain.handle(IPC.openBackupCopy, async (_e, given?: string) => {
    let src = given;
    if (!src) {
      const near = lastFailedPath() ?? currentStore()?.path;
      const dir = near ? backupDir(near) : undefined;
      const r = await dialog.showOpenDialog(parentWindow(), {
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
    const original = lastFailedPath() ?? currentStore()?.path;
    const listed = original ? listBackups(original).find((b) => b.path === src) : undefined;
    const stamp = fileStamp(listed ? new Date(listed.createdAt) : statSync(src).mtime);
    const base = (original ? basename(original) : basename(src))
      .replace(/\.feldspur$/i, "")
      .replace(/_\d{4}-\d\d-\d\d_.*$/, "");
    const r = await dialog.showSaveDialog(parentWindow(), {
      title: "Wiederhergestellte Kopie speichern unter",
      defaultPath: join(original ? dirname(original) : dirname(dirname(src)), `${base} (Stand ${stamp}).feldspur`),
      filters: [{ name: "Feldspur-Projekt", extensions: ["feldspur"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const dest = r.filePath.endsWith(".feldspur") ? r.filePath : `${r.filePath}.feldspur`;
    const openPath = currentStore()?.path;
    if (openPath && resolve(dest) === resolve(openPath))
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
}
