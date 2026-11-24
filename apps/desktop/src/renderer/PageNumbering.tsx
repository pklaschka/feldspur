/**
 * Seitenzählung eines Tagebuch-Scans in der Detailleiste: erste Seitenzahl im Notizbuch und
 * ob jedes Bild eine Doppelseite zeigt. Die Zählung lässt sich über die folgenden Scans desselben
 * Geräts fortsetzen (PDFs zählen je Seite weiter).
 *
 * Eingebunden in die Detailleiste (`apps/desktop/src/renderer/Inspector.tsx`) für Quellen der Art Tagebuch
 * (`kind === "diary"`). Gespeichert wird über `setPageNumbering` (Handler in `apps/desktop/src/main/ipc/review.ts`,
 * rückgängig als „Seitenzählung geändert“); die Rechnung fürs Weiterzählen steht in `packages/core/src/pages.ts`.
 */
import { continuePages, pageRangeText } from "@feldspur/core/pages";
import { useState } from "react";
import type { SessionView, SourceRow } from "../shared/api.ts";
import type { ApplyView } from "./Notes.tsx";
import { loadPdf, usePdfPageCount } from "./pdf.tsx";
import { Button, Eyebrow, Toggle } from "./ui.tsx";
import { useDraft } from "./hooks.ts";
import { isEnter } from "./keys.js";

const api = window.feldspur;
const byLabel = (a: SourceRow, b: SourceRow) => a.label.localeCompare(b.label, "de", { numeric: true });

/** Seiten eines Scans fürs Weiterzählen: ein Bild zählt als eine, ebenso ein PDF, das sich nicht öffnen lässt. */
async function pdfPages(row: SourceRow): Promise<number> {
  if (!row.isPdf) return 1;
  try {
    return (await loadPdf(row.id)).numPages || 1;
  } catch {
    return 1;
  }
}

/** Abschnitt „Seitenzählung“ für den Scan `row`; `apply` führt die Änderung aus und übernimmt die neue Ansicht. */
export function PageNumbering({ row, view, apply }: { row: SourceRow; view: SessionView; apply: ApplyView }) {
  const [text, setText] = useDraft(row.firstPage === null ? "" : String(row.firstPage), row.id);
  const pdfCount = usePdfPageCount(row.isPdf ? row.id : null);
  const [busy, setBusy] = useState(false);

  const save = (firstPage: number | null, spread: boolean) =>
    apply(() => api.setPageNumbering([{ sourceId: row.id, firstPage, spread }]));
  // Leeres Feld = keine Seitenzahl (null); Unbrauchbares setzt das Feld auf den gespeicherten Wert zurück.
  const commit = () => {
    const t = text.trim();
    const n = t === "" ? null : Number(t);
    if (n !== null && (!Number.isInteger(n) || n < 0))
      return setText(row.firstPage === null ? "" : String(row.firstPage));
    if (n !== row.firstPage) save(n, row.pageSpread);
  };

  // Weitergezählt wird in den späteren Scans desselben Geräts, in der Reihenfolge der Kurzzeichen (T-02 nach T-01).
  // Weitere Bilder einer Seite (`partOf`) zählen nicht eigens und bieten das Weiterzählen auch nicht an.
  const following = row.partOf
    ? []
    : view.rows
        .filter(
          (r) =>
            r.kind === "diary" && !r.partOf && r.id !== row.id && r.deviceId === row.deviceId && byLabel(r, row) > 0,
        )
        .sort(byLabel);
  const per = row.pageSpread ? 2 : 1;
  const scans = row.isPdf ? (pdfCount ?? 0) : 1;
  const shows =
    row.firstPage !== null && scans > 0 ? pageRangeText(row.firstPage, row.firstPage + scans * per - 1) : null;

  const carryOn = async () => {
    if (row.firstPage === null) return;
    setBusy(true);
    try {
      const counts = await Promise.all([row, ...following].map(pdfPages));
      const next = continuePages(
        { firstPage: row.firstPage, pageSpread: row.pageSpread, pdfPages: counts[0]! },
        following.map((f, i) => ({ id: f.id, pdfPages: counts[i + 1]! })),
      );
      // Die folgenden Scans übernehmen dabei auch die Doppelseiten-Einstellung dieses Scans.
      apply(() =>
        api.setPageNumbering(next.map((n) => ({ sourceId: n.id, firstPage: n.firstPage, spread: row.pageSpread }))),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="page-numbering">
      <Eyebrow>Seitenzählung</Eyebrow>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9rem]">
        <label className="flex items-center gap-2">
          {row.isPdf ? "Erste Seite" : "Seite"}
          <input
            className="w-[4.5rem] font-mono"
            inputMode="numeric"
            value={text}
            placeholder="–"
            aria-label={`Seitenzahl im Notizbuch für ${row.label}`}
            onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={commit}
            onKeyDown={(e) => isEnter(e) && commit()}
          />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <Toggle
            checked={row.pageSpread}
            onChange={(v) => save(row.firstPage, v)}
            label={`Doppelseite ${row.label}`}
          />
          Doppelseite
        </label>
      </div>
      <p className="mt-1.5 text-[0.85rem] text-muted">
        {shows
          ? `${row.label} zeigt ${shows}${row.pageSpread ? ". Rahmen links gehören zur linken, rechts zur rechten Seite." : "."}`
          : row.pageSpread
            ? "Rahmen links gehören zur linken, rechts zur rechten Seite. Mit einer Seitenzahl heißen sie z. B. „S. 7“ und „S. 8“."
            : "Seitenzahl aus dem Notizbuch, falls sie nicht der Reihenfolge der Scans entspricht. Fotografierte Doppelseiten hier als Doppelseite markieren."}
        Einzelne Einträge bekommen beim Abtippen eine eigene Seitenzahl, wenn die Zählung nicht passt.
      </p>
      {row.firstPage !== null && following.length > 0 && (
        <Button
          size="sm"
          className="mt-2"
          disabled={busy}
          onClick={() => void carryOn()}
          title={`Setzt die Zählung in ${following[0]!.label}${following.length > 1 ? ` bis ${following.at(-1)!.label}` : ""} fort und überschreibt dort vorhandene Angaben`}
        >
          {following.length === 1
            ? `${following[0]!.label} weiterzählen`
            : `Folgende ${following.length} Scans weiterzählen`}
        </Button>
      )}
    </div>
  );
}
