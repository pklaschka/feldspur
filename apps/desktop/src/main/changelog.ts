/**
 * Änderungsprotokoll als CSV: eine Zeile je geändertem Feld, wie das Begleitprotokoll mit Semikolon und BOM,
 * damit Excel und LibreOffice Umlaute richtig lesen. Ohne Electron, damit es sich direkt testen lässt.
 */
import type { ChangeStep, History } from "@feldspur/core";
import { excelCsv } from "@feldspur/media/csv";
import { fieldChanges, OP_LABEL, TABLE_LABEL } from "../shared/changelog.ts";

export function changeLogRows(steps: ChangeStep[]): unknown[][] {
  const rows: unknown[][] = [];
  // Älteste zuerst: so liest man ein Protokoll.
  for (const s of [...steps].reverse()) {
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
      for (const f of fields) rows.push([...base, f.field, f.before, f.after]);
    }
  }
  return rows;
}

export function changeLogCsv(history: History): string {
  const steps: ChangeStep[] = [];
  for (let before: number | undefined; ;) {
    const page = history.changeLog({ limit: 500, before });
    if (!page.length) break;
    steps.push(...page);
    before = page.at(-1)!.step;
  }
  const head = ["Zeit (UTC)", "Schritt", "Aktion", "Bereich", "Art", "Zeile", "Feld", "vorher", "nachher"];
  return excelCsv([head, ...changeLogRows(steps)]);
}
