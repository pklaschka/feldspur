/** Kleine Bausteine für Kontextstücke (Issue #108): Vorschaubild und Schlüssel der Auswahl. */
import type { CSSProperties } from "react";
import { mediaUrl, type ContextRow, type SessionView } from "../../shared/api.ts";
import { PdfPageCanvas } from "../pdf.tsx";
import { cx } from "../ui.tsx";

/**
 * Was in der App als gewählt gilt: Quellen wie immer über ihre Id, Kontext-Einträge (Tagebuch, Text ohne Scan)
 * über „entry:<id>“.
 */
export const selectionOf = (c: ContextRow) => (c.key.startsWith("source:") && c.sourceId ? c.sourceId : c.key);

/** Kontextstück zur Auswahl: ein Eintrag, eine Kontext-Quelle oder eine Tagebuchseite, die ganz Kontext ist. */
export function contextFor(view: SessionView, selected: string | null): ContextRow | null {
  if (!selected) return null;
  const direct = view.context.find((c) => c.key === selected || c.key === `source:${selected}`);
  if (direct) return direct;
  // Tagebuchseite, deren Einträge alle Kontext sind: das erste Stück auf ihr.
  const row = view.rows.find((r) => r.id === selected);
  if (row?.status !== "context") return null;
  return view.context.find((c) => c.thumb?.sourceId === row.id) ?? null;
}

/** Vorschau eines Kontextstücks: ganzes Bild oder der Rahmen auf der Seite; sonst ein Platzhalter. */
export function ContextThumb({ c, className }: { c: ContextRow; className?: string }) {
  const t = c.thumb;
  const box = cx("relative flex-none overflow-hidden rounded border border-line bg-sunken", className);
  if (!t || (!t.previewable && !t.isPdf))
    return (
      <span aria-hidden className={cx(box, "grid place-items-center text-[0.72rem] text-muted")}>
        {c.kind === "note" || !c.thumb ? "Text" : "–"}
      </span>
    );
  if (t.isPdf)
    return (
      <span aria-hidden className={cx(box, "bg-white")}>
        <PdfPageCanvas sourceId={t.sourceId} page={t.region?.page ?? 0} maxWidth={90} className="block" />
      </span>
    );
  const r = t.region;
  // Ausschnitt: Breite im Verhältnis zum Rahmen, verschoben um die eigene Größe (Prozent von translate).
  const style: CSSProperties | undefined =
    r && r.w > 0 && r.h > 0 && (r.w < 1 || r.h < 1)
      ? { width: `${100 / r.w}%`, maxWidth: "none", transform: `translate(${-r.x * 100}%, ${-r.y * 100}%)` }
      : undefined;
  return (
    <span aria-hidden className={box}>
      <img
        src={mediaUrl(t.sourceId)}
        alt=""
        className={cx("block", style ? "origin-top-left" : "size-full object-cover")}
        style={style}
      />
    </span>
  );
}
