/**
 * Änderungsprotokoll als CSV: eine Zeile je geändertem Feld, wie das Begleitprotokoll mit Semikolon und BOM,
 * damit Excel und LibreOffice Umlaute richtig lesen. Ohne Electron, damit es sich direkt testen lässt.
 */
import type { ChangeEntry, ChangeStep, History } from "@feldspur/core";
import { excelCsv } from "@feldspur/media/csv";
import { decisionText, fieldChanges, OP_LABEL, TABLE_LABEL } from "../shared/changelog.ts";

export function changeLogRows(steps: ChangeStep[]): unknown[][] {
  const rows: unknown[][] = [];
  // Älteste zuerst: so liest man ein Protokoll.
  for (const s of steps.toReversed()) {
    for (const c of s.changes) {
      const fields = fieldChanges(c);
      const base = [
        s.at,
        s.step,
        s.label ?? "(ohne Beschriftung)",
        TABLE_LABEL[c.table] ?? c.table,
        OP_LABEL[c.op],
        c.rowKey,
      ];
      if (!fields.length) rows.push([...base, "", "", ""]);
      // Entscheidungen lesbar statt als JSON (der Rohwert steht in der Projektdatei).
      const show = (field: string, v: unknown) => (field === "decision" && v !== null ? decisionText(v) : v);
      for (const f of fields) rows.push([...base, f.field, show(f.field, f.before), show(f.field, f.after)]);
    }
  }
  return rows;
}

/** Alle Schritte des Protokolls, neueste zuerst. */
function allSteps(history: History): ChangeStep[] {
  const steps: ChangeStep[] = [];
  for (let before: number | undefined; ;) {
    const page = history.changeLog({ limit: 500, before });
    if (!page.length) break;
    steps.push(...page);
    before = page.at(-1)!.step;
  }
  return steps;
}

const HEAD = ["Zeit (UTC)", "Schritt", "Aktion", "Bereich", "Art", "Zeile", "Feld", "vorher", "nachher"];

export function changeLogCsv(history: History): string {
  return excelCsv([HEAD, ...changeLogRows(allSteps(history))]);
}

/**
 * Nur die Änderungen, die einen Einsatz betreffen (Issue #204): der Einsatz selbst, alles mit seiner session_id und
 * alles an seinen Quellen (auch an inzwischen gelöschten). Projektweites wie Personen bleibt draußen, damit der
 * Ausgabeordner eines Einsatzes nichts über andere Einsätze verrät.
 */
export function sessionSteps(steps: ChangeStep[], sessionId: string, sourceIds: Iterable<string> = []): ChangeStep[] {
  const val = (c: ChangeEntry, k: string) => c.after?.[k] ?? c.before?.[k];
  const sources = new Set(sourceIds);
  for (const s of steps)
    for (const c of s.changes) if (c.table === "sources" && val(c, "session_id") === sessionId) sources.add(c.rowKey);
  const mine = (c: ChangeEntry) =>
    c.table === "sessions"
      ? c.rowKey === sessionId
      : val(c, "session_id") === sessionId ||
        ["source_id", "a_source_id", "b_source_id"].some((k) => sources.has(String(val(c, k))));
  return steps.map((s) => ({ ...s, changes: s.changes.filter(mine) })).filter((s) => s.changes.length > 0);
}

/** Änderungsprotokoll eines Einsatzes für seinen Ausgabeordner. */
export function sessionChangeLogCsv(history: History, sessionId: string, sourceIds: Iterable<string> = []): string {
  return excelCsv([HEAD, ...changeLogRows(sessionSteps(allSteps(history), sessionId, sourceIds))]);
}
