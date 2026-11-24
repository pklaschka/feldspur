/**
 * Kontext-Zeile über der Zeitachse (Issue #108): Stücke ohne Uhrzeit in der Reihenfolge, in der sie im
 * Einsatztranskript vor der Chronologie stehen. Kein Minutenraster, keine Spur; einklappbar. Eingebaut in
 * `Review.tsx` (Schritt Durchsehen); ein Klick wählt das Stück, die Einzelheiten zeigt dann `ContextPanel.tsx`.
 */
import { useState, type KeyboardEvent } from "react";
import type { ContextRow, SessionView } from "../../shared/api.ts";
import type { ApplyView } from "../Notes.tsx";
import { Button, ContextMark, cx } from "../ui.tsx";
import { ContextThumb, contextFor, selectionOf } from "./parts.tsx";
import { readStored, writeStored } from "../stored.ts";

const api = window.feldspur;

/** Ab hier zeigt die Zeile „+ n weitere“ (die volle Liste steht in Ausgeben). */
const SHOWN = 8;

const collapsedKey = (sessionId: string) => `feldspur.context-collapsed.${sessionId}`;
const readCollapsed = (sessionId: string) => readStored(collapsedKey(sessionId)) === "1";

export function ContextStrip({
  view,
  selected,
  onSelect,
  apply,
  onCreateText,
}: {
  view: SessionView;
  selected: string | null;
  onSelect: (id: string) => void;
  apply: ApplyView;
  /** Neues Kontextstück als Text ohne Scan anlegen. */
  onCreateText: () => void;
}) {
  const sessionId = view.session.id;
  const [collapsed, setCollapsed] = useState(() => readCollapsed(sessionId));
  const [all, setAll] = useState(false);
  const items = view.context;
  const current = contextFor(view, selected);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeStored(collapsedKey(sessionId), next ? "1" : "0");
  };
  const move = (c: ContextRow, to: number) => {
    if (to < 1 || to > items.length || to === c.position) return;
    apply(() => api.moveContext(c.key, to));
  };
  const onKey = (e: KeyboardEvent, c: ContextRow) => {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    move(c, c.position + (e.key === "ArrowLeft" ? -1 : 1));
  };
  const shown = all || items.length <= SHOWN + 1 ? items : items.slice(0, SHOWN);

  return (
    <section
      className="mb-3 rounded-lg border border-line bg-panel px-3 py-2"
      aria-label="Kontext"
      data-testid="context-strip"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="inline-flex items-center gap-1.5 text-[0.95rem] font-semibold">
          <ContextMark decorative />
          Kontext ({items.length})
        </h3>
        <span className="text-[0.85rem] text-muted">
          {items.length
            ? "ohne Uhrzeit · steht in dieser Reihenfolge vor der Chronologie"
            : "Karten, Listen und Zusammenfassungen ohne Uhrzeit: über ⋯ an einer Datei „Als Kontext führen“."}
        </span>
        <span className="flex-1" />
        {items.length > 1 && !collapsed && (
          <Button size="sm" variant="ghost" onClick={() => apply(() => api.sortContextByPage(sessionId))}>
            Nach Seite ordnen
          </Button>
        )}
        {!collapsed && (
          <Button size="sm" variant="ghost" onClick={onCreateText} data-testid="context-new-text">
            + Text
          </Button>
        )}
        {items.length > 0 && (
          <Button size="sm" variant="ghost" onClick={toggle} aria-expanded={!collapsed}>
            {collapsed ? "Ausklappen" : "Einklappen"}
          </Button>
        )}
      </div>
      {!collapsed && items.length > 0 && (
        <ol className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {shown.map((c) => {
            const on = current?.key === c.key;
            return (
              <li key={c.key} className="flex-none">
                <button
                  type="button"
                  data-testid="context-card"
                  aria-current={on || undefined}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  title={`${c.name} · ${c.find}${items.length > 1 ? " · Alt+←/→ verschiebt" : ""}`}
                  className={cx(
                    "flex w-56 cursor-pointer items-center gap-2 rounded-lg border p-1.5 text-left",
                    on ? "border-accent bg-accent-soft" : "border-line bg-bg hover:border-line-2",
                  )}
                  onClick={() => onSelect(selectionOf(c))}
                  onKeyDown={(e) => onKey(e, c)}
                >
                  <b className="w-4 flex-none text-center font-mono text-[0.85rem] text-ink-2">{c.position}</b>
                  <ContextThumb c={c} className="h-10 w-12" />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.88rem] font-medium">{c.name}</span>
                    <span className="block truncate text-[0.78rem] text-muted">
                      {c.title ? c.find : c.personName || c.find}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length < items.length && (
            <li className="flex-none self-center">
              <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
                + {items.length - shown.length} weitere
              </Button>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
