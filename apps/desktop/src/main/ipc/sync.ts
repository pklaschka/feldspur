/** IPC-Aufrufe fürs Abgleichen: Tonspuren analysieren, Uhren der Geräte, Anker, Zeitbelege, Lage und Lautstärke. */
import { existsSync } from "node:fs";
import { ipcMain } from "electron";
import type { ProjectStore } from "@feldspur/core";
import {
  analyzeSession,
  applyReread,
  measureSource,
  refineAlignment,
  rereadChanges,
  rereadSource,
  type RereadSource,
} from "@feldspur/media";
import { IPC, type AnchorInput, type LevelInput, type TimeInput } from "../../shared/api.ts";
import {
  addManualAnchor,
  addTimeEvidence,
  clearDeviceChecks,
  confirmAnchors,
  confirmPlacement,
  decideMany,
  decidePlacement,
  proposalsToConfirm,
  kindHolds,
  kindName,
  type DecideInput,
  removeEvidence,
  replaceAnchor,
  setLevel,
  toggleEvidence,
} from "../edits.ts";
import { buildSessionView } from "../view.ts";
import { unreachableForAnalysis } from "../originals.ts";
import { analyzing, currentStore, requireStore, stillOpen, whileOpen } from "../state.ts";
import { undoableView } from "./undoable.ts";

/** „F-003, Dateiname“ für Beschriftungen im Verlauf. */
function evidenceLabel(s: ProjectStore, evidenceId: string): { source: string; kind: string; checked: boolean } {
  const ev = s.getEvidence(evidenceId);
  return { source: s.getSource(ev.sourceId).label, kind: kindName(ev.kind), checked: ev.kind === "checked" };
}

export function registerSyncIpc(): void {
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
      if (currentStore() !== s)
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

  // Uhren der Geräte: Referenzuhr, Abweichung, Zeitzone, Zeitbelege aus den Dateien.
  undoableView(
    IPC.setReference,
    "Referenzuhr gewählt",
    (s, deviceId: string) => s.setReferenceDevice(deviceId).sessionId,
  );
  undoableView(
    IPC.setDeviceOffset,
    "Uhrabweichung geändert",
    (s, deviceId: string, offsetMs: number | null) =>
      s.updateDevice(
        deviceId,
        offsetMs === null
          ? { offsetBasis: "unknown", clockOffsetMs: 0, isReference: false }
          : {
              offsetBasis: "manual",
              clockOffsetMs: Math.round(offsetMs),
              clockOffsetUncertaintyMs: 1000,
              isReference: false,
            },
      ).sessionId,
  );
  undoableView(IPC.setDeviceTimeZone, "Zeitzone geändert", (s, deviceId: string, timeZone: string | null) => {
    const zone = timeZone?.trim() || null;
    if (zone) {
      try {
        new Intl.DateTimeFormat("de", { timeZone: zone });
      } catch {
        throw new Error(`Unbekannte Zeitzone „${zone}“`);
      }
    }
    return s.updateDevice(deviceId, { timeZone: zone }).sessionId;
  });
  undoableView(
    IPC.setDeviceUtc,
    (s, deviceId: string, utc: boolean) =>
      `Zeitstempel von ${s.getDevice(deviceId).label} als ${utc ? "UTC" : "Ortszeit"} gelesen`,
    (s, deviceId: string, utc: boolean) => s.updateDevice(deviceId, { timestampsAreUtc: utc }).sessionId,
  );
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

  undoableView(IPC.confirmAnchor, "Vorschlag übernommen", (s, anchorId: string) => {
    const a = s.getAnchor(anchorId);
    s.confirmAnchor(anchorId);
    // Weitere Vorschläge für dasselbe Gerät sind damit erledigt: seine Uhr ist jetzt abgeglichen.
    const device = s.getSource(a.b.sourceId).deviceId;
    for (const other of s.listAnchors(a.sessionId)) {
      if (other.proposed && device && s.getSource(other.b.sourceId).deviceId === device) s.deleteAnchor(other.id);
    }
    return a.sessionId;
  });
  undoableView(
    IPC.confirmAnchors,
    (s, sessionId: string, anchorIds: string[]) => {
      const n = proposalsToConfirm(s, sessionId, anchorIds).length;
      return n === 1 ? "Vorschlag übernommen" : `${n} Vorschläge übernommen`;
    },
    (s, sessionId: string, anchorIds: string[]) => {
      confirmAnchors(s, sessionId, anchorIds);
      return sessionId;
    },
  );

  undoableView(IPC.rejectAnchor, "Anker entfernt", (s, anchorId: string) => {
    const a = s.getAnchor(anchorId);
    s.deleteAnchor(anchorId);
    return a.sessionId;
  });

  undoableView(
    IPC.confirmPlacement,
    (s, sourceId: string, _startMs: number) => `Lage bestätigt: ${s.getSource(sourceId).label}`,
    (s, sourceId: string, startMs: number) => confirmPlacement(s, sourceId, startMs),
  );
  undoableView(
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
    (s, input: DecideInput) => decidePlacement(s, input),
  );
  undoableView(
    IPC.decideMany,
    (s, input: { sourceIds: string[]; kind: string; reason: string }) => {
      const first = input.sourceIds[0] ? s.getSource(input.sourceIds[0]) : null;
      const dev = first?.deviceId ? ` von ${s.getDevice(first.deviceId).label}` : "";
      return `Widersprüche entschieden: ${input.sourceIds.length} Dateien${dev}, ${kindHolds(input.kind)}`;
    },
    (s, input: { sourceIds: string[]; kind: string; reason: string }) => decideMany(s, input),
  );
  undoableView(IPC.addTime, "Uhrzeit eingetragen", (s, input: TimeInput) => addTimeEvidence(s, input));

  undoableView(
    IPC.setEvidenceEnabled,
    (s, evidenceId: string, enabled: boolean) => {
      const l = evidenceLabel(s, evidenceId);
      return `Zeitbeleg ${enabled ? "eingeschaltet" : "abgeschaltet"}: ${l.source}, ${l.kind}`;
    },
    (s, evidenceId: string, enabled: boolean) => toggleEvidence(s, evidenceId, enabled),
  );

  undoableView(
    IPC.removeEvidence,
    (s, evidenceId: string) => {
      const l = evidenceLabel(s, evidenceId);
      return l.checked ? `Entscheidung zurückgenommen: ${l.source}` : `Zeitbeleg gelöscht: ${l.source}, ${l.kind}`;
    },
    (s, evidenceId: string) => removeEvidence(s, evidenceId),
  );

  undoableView(IPC.addAnchor, "Anker gesetzt", (s, input: AnchorInput) => addManualAnchor(s, input));
  undoableView(IPC.replaceAnchor, "Anker geändert", (s, anchorId: string, input: AnchorInput) =>
    replaceAnchor(s, anchorId, input),
  );
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
  undoableView(IPC.setLevel, "Lautstärke geändert", (s, sourceId: string, input: LevelInput) =>
    setLevel(s, sourceId, input),
  );
  ipcMain.handle(IPC.measureLevel, async (_e, sourceId: string) => {
    const s = requireStore();
    await whileOpen(s, measureSource(s, sourceId));
    return buildSessionView(s, s.getSource(sourceId).sessionId);
  });
}
