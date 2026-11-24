/**
 * Karte „Kontext“ im Schritt „Ausgeben“ (`apps/desktop/src/renderer/ExportStep.tsx`): die Reihenfolge, in der die
 * Kontextstücke im Einsatztranskript vor der Chronologie stehen. Umsortieren geht per `moveContext` an den
 * Hauptprozess (`apps/desktop/src/main/ipc/review.ts`), der den neuen Stand des Einsatzes (`SessionView`) zurückgibt.
 */
import type { SessionView } from "../../shared/api.ts";
import { Button, ContextMark } from "../ui.tsx";

const api = window.feldspur;

/** Karte „Kontext (n)“: Reihenfolge vor der Chronologie, mit ↑ ↓; Kontext zählt nicht als offen. */
export function ContextCard({ view, onView }: { view: SessionView; onView: (v: SessionView) => void }) {
  const items = view.context;
  const untitled = items.filter((c) => !c.title).length;
  // Quellen, deren Originaldatei fehlt oder nicht lesbar ist; betrifft Kontextstücke mit Bild (`thumb`).
  const gone = new Set(view.rows.filter((r) => r.file === "missing" || r.file === "unreadable").map((r) => r.id));
  const missing = items.filter((c) => c.thumb && gone.has(c.thumb.sourceId)).length;
  const move = (key: string, to: number) => void api.moveContext(key, to).then(onView, () => {});
  return (
    <section className="mt-5 border-t border-line pt-3 text-[0.9rem]" data-testid="export-context">
      <b className="inline-flex items-center gap-1.5 font-semibold">
        <ContextMark decorative />
        Kontext ({items.length})
      </b>
      <p className="mb-1.5 text-[0.85rem] text-muted">
        Steht vor der ersten Zeitmarke, in dieser Reihenfolge. Kontext zählt nicht als offen.
      </p>
      <ol className="grid gap-0.5">
        {items.map((c) => (
          <li key={c.key} className="flex items-center gap-2">
            <b className="w-5 text-right font-mono text-ink-2">{c.position}</b>
            <span className="min-w-0 flex-1 truncate" title={c.find}>
              {c.name}
            </span>
            {items.length > 1 && (
              <span className="flex">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={c.position <= 1}
                  aria-label={`${c.name} weiter nach vorn`}
                  title="weiter nach vorn"
                  onClick={() => move(c.key, c.position - 1)}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={c.position >= items.length}
                  aria-label={`${c.name} weiter nach hinten`}
                  title="weiter nach hinten"
                  onClick={() => move(c.key, c.position + 1)}
                >
                  ↓
                </Button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[0.85rem] text-muted">
        {untitled
          ? `${untitled} ohne Titel: Im Dokument steht die Fundstelle.`
          : missing
            ? `✓ Alle haben einen Titel. ${missing === 1 ? "Ein Bild fehlt" : `${missing} Bilder fehlen`} (Originale).`
            : "✓ Alle haben einen Titel. Alle Bilder sind vorhanden."}
      </p>
    </section>
  );
}
