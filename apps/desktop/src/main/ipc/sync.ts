/** IPC-Aufrufe fürs Abgleichen: Tonspuren analysieren, Anker, Zeitbelege, Lage und Lautstärke. */
import { ipcMain } from "electron";
import type { ProjectStore } from "@feldspur/core";
import { analyzeSession, measureSource, refineAlignment } from "@feldspur/media";
import { IPC, type AnchorInput, type LevelInput, type PageNumberingInput, type TimeInput } from "../../shared/api.ts";
import {
  addManualAnchor,
  addTimeEvidence,
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
  setPageNumbering,
  toggleEvidence,
} from "../edits.ts";
import { buildSessionView } from "../view.ts";
import { unreachableForAnalysis } from "../originals.ts";
import { analyzing, currentStore, requireStore, stillOpen, undoable, undoableView } from "../state.ts";

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
  undoableView(IPC.setPageNumbering, "Seitenzählung geändert", (s, items: PageNumberingInput[]) =>
    setPageNumbering(s, items),
  );
  ipcMain.handle(IPC.measureLevel, async (_e, sourceId: string) => {
    const s = requireStore();
    await measureSource(s, sourceId);
    return buildSessionView(stillOpen(s), s.getSource(sourceId).sessionId);
  });
}
