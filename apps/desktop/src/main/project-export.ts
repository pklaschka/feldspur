/**
 * „Alle Einsätze ausgeben…“ in der Übersicht (Issue #209, Stufe 7 des Gesamtkonzepts #202): die gewählten Einsätze
 * nacheinander in einen gemeinsamen Projektordner ausgeben, je Einsatz ein Unterordner wie im Schritt „Ausgeben“
 * (`runExport` in `export.ts`). Darüber entsteht eine LIESMICH mit den Tabellen über alle Einsätze, dem Feldkalender
 * und der Liste der Ordner, auf Wunsch auch die Metadaten (RO-Crate) für das ganze Projekt.
 *
 * Zwei Regeln halten den Ordner ehrlich:
 * - Ein Einsatz, dessen Ausgabe im Projektordner schon zum jetzigen Stand und zu den Einstellungen passt, wird nicht
 *   neu ausgegeben.
 * - Die gemeinsame LIESMICH gibt es nur, wenn jeder gewählte Einsatz in seinem jetzigen Stand im Ordner liegt. Beim
 *   Start verschwindet eine ältere; bleibt ein Einsatz offen (Prüfung der Originale, Fehler, Abbruch), fehlt sie, bis
 *   ein weiterer Lauf alles ausgegeben hat. So beschreibt sie nie einen Stand, der nicht im Ordner liegt.
 *
 * Aufgerufen aus `ipc/export.ts`; die Texte der LIESMICH und der Metadaten baut `packages/media`
 * (`project-folder.ts`, `ro-crate.ts`).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { WebContents } from "electron";
import type { ProjectStore } from "@feldspur/core";
import {
  log,
  methodsSummary,
  PROJECT_README_MARK,
  projectDataset,
  projectReadmeHtml,
  projectRoCrateJson,
  README_NAME,
  RO_CRATE_NAME,
  safeName,
  type ProjectFolder,
} from "@feldspur/media";
import {
  IPC,
  type ExportChoices,
  type ProjectExportProgress,
  type ProjectExportResult,
  type ProjectExportSession,
} from "../shared/api.ts";
import { beginBatch, exportSettings, runExport } from "./export.ts";

const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/** Liegt in `dir` die LIESMICH eines Projektordners von Feldspur? */
function hasProjectReadme(dir: string): boolean {
  try {
    return readFileSync(join(dir, README_NAME), "utf8").slice(0, 2000).includes(PROJECT_README_MARK);
  } catch {
    return false;
  }
}

/** Name des Projektordners: der Name des Projekts ohne Zeichen, die in Dateinamen stören. */
function projectFolderName(s: ProjectStore): string {
  return safeName(s.getMeta("name") || "") || "Projekt";
}

/**
 * Der Projektordner zu einem gewählten Ordner: Wer den Projektordner selbst wählt (er trägt schon eine LIESMICH von
 * Feldspur), bleibt darin; sonst entsteht er darin unter dem Namen des Projekts, so wie der Schritt „Ausgeben“ den
 * Ordner eines Einsatzes anlegt.
 */
export function projectDirIn(s: ProjectStore, chosen: string): string {
  return hasProjectReadme(chosen) ? chosen : join(chosen, projectFolderName(s));
}

/**
 * Vorgabe für den Ordnerdialog: der Ordner, in dem der letzte Projektordner liegt. Erkannt an den Ausgaben der
 * Einsätze: Ihr gemeinsamer Ordner trägt eine LIESMICH des Projektordners.
 */
export function lastProjectParent(s: ProjectStore): string | undefined {
  for (const x of s.listSessions()) {
    const dir = s.getExportRecord(x.id)?.dir;
    const project = dir ? dirname(dir) : undefined;
    if (project && hasProjectReadme(project) && existsSync(dirname(project))) return dirname(project);
  }
  return undefined;
}

/** Was die Prüfung der Originale gefunden hat, in einem Satz für die Liste. */
function heldText(blocking: number, warnings: number): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (blocking)
    return `${n(blocking, "Original fehlt", "Originale fehlen")} oder ${blocking === 1 ? "ist" : "sind"} nicht lesbar.`;
  return `${n(warnings, "Original ist", "Originale sind")} verändert oder ${warnings === 1 ? "fehlt" : "fehlen"}.`;
}

/**
 * Die Einsätze `sessionIds` in den Projektordner `dir` ausgeben und, wenn danach alle im jetzigen Stand dort liegen,
 * die gemeinsame LIESMICH schreiben. `accept` nennt Einsätze, bei denen Auffälligkeiten der Originale bewusst
 * übergangen werden („Trotzdem ausgeben“).
 */
export async function runProjectExport(
  s: ProjectStore,
  wc: WebContents,
  sessionIds: readonly string[],
  dir: string,
  opts: ExportChoices & {
    software?: string;
    softwareRef?: { version: string; url: string };
    accept?: readonly string[];
  },
): Promise<ProjectExportResult> {
  const batch = beginBatch();
  try {
    const known = new Map(s.listSessions().map((x) => [x.id, x]));
    const chosen = [...new Set(sessionIds)]
      .flatMap((id) => (known.has(id) ? [known.get(id)!] : []))
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    const readmePath = join(dir, README_NAME);
    if (existsSync(readmePath) && !hasProjectReadme(dir))
      throw new Error(
        `In ${dir} liegt schon eine ${README_NAME}, die nicht von einem Projektordner stammt. Bitte einen anderen Ordner wählen.`,
      );
    mkdirSync(dir, { recursive: true });
    log("ausgabe", `Projektordner ${dir}: ${chosen.length} Einsätze`);
    // Ab jetzt ändert sich der Ordner: Die alte Beschreibung gilt nicht mehr, bis die neue geschrieben ist.
    await rm(readmePath, { force: true });
    await rm(join(dir, RO_CRATE_NAME), { force: true });

    const send = (p: ProjectExportProgress) => {
      if (!wc.isDestroyed()) wc.send(IPC.projectExportProgress, p);
    };
    /** Liegt die Ausgabe des Einsatzes im Projektordner, und passt sie zum jetzigen Stand? */
    const inFolder = (id: string) => {
      const record = s.getExportRecord(id);
      const summary = methodsSummary(s, id, exportSettings(s, id, opts));
      const here = !!record && same(dirname(record.dir), dir);
      return { record, summary, current: here && summary.exported === "current" };
    };

    const rows: ProjectExportSession[] = [];
    for (const [index, x] of chosen.entries()) {
      const row: ProjectExportSession = { sessionId: x.id, title: x.title, date: x.date, outcome: "pending" };
      rows.push(row);
      if (batch.aborted()) continue;
      const before = inFolder(x.id);
      if (before.summary.output.durationMs <= 0) {
        row.outcome = "empty";
        continue;
      }
      if (before.current) {
        row.outcome = "unchanged";
        row.folder = basename(before.record!.dir);
        continue;
      }
      send({ index, total: chosen.length, sessionId: x.id });
      try {
        const r = await runExport(s, wc, x.id, dir, {
          ...opts,
          acceptOriginals: opts.accept?.includes(x.id) === true,
        });
        if ("cancelled" in r) row.outcome = "cancelled";
        else if ("originals" in r) {
          row.outcome = "held";
          row.blocking = r.originals.blocking.length > 0;
          row.detail = heldText(r.originals.blocking.length, r.originals.warnings.length);
        } else {
          row.outcome = "written";
          row.folder = basename(r.dir);
        }
      } catch (e) {
        row.outcome = "failed";
        row.detail = e instanceof Error ? e.message : String(e);
      }
    }
    send({ index: chosen.length, total: chosen.length, sessionId: null });

    // Zum Schluss noch einmal nachsehen: Wer während des Laufs weitergearbeitet hat, hat einen Einsatz vielleicht
    // schon wieder verändert. In die LIESMICH kommt nur, was genau so im Ordner liegt.
    const inside: ProjectFolder["sessions"] = [];
    let open = 0;
    for (const row of rows) {
      if (row.outcome === "empty") continue;
      const now = inFolder(row.sessionId);
      if (!now.current || !now.record) {
        open++;
        if (row.outcome === "written" || row.outcome === "unchanged") {
          row.outcome = "failed";
          row.detail = "Seit der Ausgabe hat sich der Einsatz geändert.";
        }
        continue;
      }
      inside.push({
        folder: basename(now.record.dir),
        numbers: now.summary,
        place: known.get(row.sessionId)?.place ?? "",
        marks: now.summary.marks,
        exportedAt: now.record.exportedAt,
        files: now.record.files,
      });
    }
    const complete = inside.length > 0 && open === 0 && !batch.aborted();
    const files: string[] = [];
    if (complete) {
      const folders = new Set(inside.map((x) => x.folder.toLowerCase()));
      // Ordner anderer Einsätze aus früheren Läufen bleiben liegen; die LIESMICH nennt sie, ohne sie zu beschreiben.
      const others = s
        .listSessions()
        .flatMap((x) => {
          const d = s.getExportRecord(x.id)?.dir;
          return d && same(dirname(d), dir) && existsSync(d) && !folders.has(basename(d).toLowerCase())
            ? [basename(d)]
            : [];
        })
        .sort();
      const used = new Set(s.listSessions().flatMap((x) => s.listDevices(x.id).map((d) => d.personId)));
      const folder: ProjectFolder = {
        name: s.getMeta("name") || "Projekt",
        dataset: projectDataset(s),
        researchers: s.listPersons().flatMap((p) => (used.has(p.id) ? [p.name] : [])),
        sessions: inside,
        roCrate: opts.roCrate === true,
        software: opts.software,
        others,
      };
      await writeFile(readmePath, projectReadmeHtml(folder), "utf8");
      files.push(README_NAME);
      if (folder.roCrate) {
        await writeFile(
          join(dir, RO_CRATE_NAME),
          projectRoCrateJson(folder, { exportedAt: new Date().toISOString(), software: opts.softwareRef }),
          "utf8",
        );
        files.push(RO_CRATE_NAME);
      }
      log("ausgabe", `Projektordner fertig: ${inside.length} Einsätze, ${files.join(", ")}`);
    }
    return { dir, sessions: rows, complete, files, cancelled: batch.aborted() };
  } finally {
    batch.end();
  }
}
