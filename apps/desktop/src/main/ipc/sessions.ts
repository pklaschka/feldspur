/** IPC-Aufrufe zu Einsätzen: anlegen und ändern, Einsammeln, Quellen und Geräte. */
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { dialog, ipcMain } from "electron";
import {
  applyImport,
  applyReread,
  rereadChanges,
  rereadSource,
  type RereadSource,
  ScanCache,
  scanPaths,
  type ScanProgress,
} from "@feldspur/media";
import { IPC, type ImportResult, type NewSessionInput, type SessionPatch } from "../../shared/api.ts";
import { clearDeviceChecks } from "../edits.ts";
import { exportingSession } from "../export.ts";
import { updateSessionDetails } from "../session.ts";
import {
  linkFollowUps,
  mergeDevices,
  moveSource,
  removeSource,
  setFollows,
  setPartOf,
  setSourceKind,
} from "../sources.ts";
import { buildSessionView } from "../view.ts";
import { relinkDuplicates } from "../originals.ts";
import {
  analyzing,
  currentStore,
  importing,
  parentWindow,
  projectInfo,
  requireStore,
  stillOpen,
  undoable,
  undoableView,
} from "../state.ts";

/** Schon vollständig gelesene Dateien: Ein zweiter Versuch nach einem Abbruch muss sie nicht erneut lesen. */
const scanCache = new ScanCache();

export function registerSessionsIpc(): void {
  undoable(IPC.createSession, "Einsatz angelegt", (_e, input: NewSessionInput) => {
    requireStore().addSession(input);
    return projectInfo();
  });

  ipcMain.handle(IPC.getSession, (_e, id: string) => buildSessionView(requireStore(), id));

  ipcMain.handle(IPC.pickFiles, async () => {
    const r = await dialog.showOpenDialog(parentWindow(), {
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
    if (currentStore() !== s)
      throw new Error("Das Projekt wurde während des Einsammelns gewechselt. Nichts übernommen.");
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
  undoableView(IPC.removeSource, "Quelle entfernt", (s, sourceId: string) => removeSource(s, sourceId));
  undoableView(IPC.moveSource, "Quelle verschoben", (s, sourceId: string, target: string | { newLabel: string }) =>
    moveSource(s, sourceId, target),
  );
  undoableView(IPC.mergeDevices, "Geräte zusammengeführt", (s, fromId: string, intoId: string) =>
    mergeDevices(s, fromId, intoId),
  );
  undoableView(IPC.setPartOf, "Seite zugeordnet", (s, sourceId: string, mainId: string | null) =>
    setPartOf(s, sourceId, mainId),
  );
  undoableView(IPC.setSourceKind, "Bildart geändert", (s, sourceId: string, kind: "diary" | "photo") =>
    setSourceKind(s, sourceId, kind),
  );
  undoableView(IPC.setFollows, "Folgeaufnahme gesetzt", (s, sourceId: string, prevId: string | null) =>
    setFollows(s, sourceId, prevId),
  );

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
    stillOpen(s);
    // Erst prüfen, ob sich etwas ändert: ein leerer Schritt im Verlauf hilft niemandem.
    const changed = rereadChanges(s, device.sessionId, read)
      ? s.history.record(`Zeitbelege neu gelesen: ${device.label}`, () => applyReread(s, device.sessionId, read))
      : 0;
    return { view: buildSessionView(s, device.sessionId), changed, missing };
  });
  undoableView(
    IPC.clearDeviceChecks,
    (s, deviceId: string) => `Bestätigungen entfernt: ${s.getDevice(deviceId).label}`,
    (s, deviceId: string) => clearDeviceChecks(s, deviceId),
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
