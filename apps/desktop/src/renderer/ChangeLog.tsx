/**
 * Änderungsprotokoll: jede gespeicherte Änderung im Projekt mit Zeit, Aktion und Werten vorher/nachher.
 * Nur zum Nachsehen; zurücknehmen geht weiter über Rückgängig. Als CSV speicherbar.
 */
import type { ChangeStep } from "@feldspur/core";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { FIELD_LABEL, OP_LABEL, TABLE_LABEL, fieldChanges, showValue } from "../shared/changelog.ts";
import { Button, CloseButton, cx } from "./ui.tsx";

const api = window.feldspur;
const PAGE = 50;

const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "medium" });

export function ChangeLog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [steps, setSteps] = useState<ChangeStep[] | null>(null);
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);

  // Bei jedem Öffnen frisch: Liste neu laden, Aufgeklapptes und Meldungen vergessen.
  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setSteps(null);
      setExpanded(new Set());
      setSaved(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api.changeLog({ limit: PAGE }).then((s) => {
      if (!live) return;
      setSteps(s);
      setMore(s.length === PAGE);
    });
    return () => {
      live = false;
    };
  }, [open]);

  const loadOlder = async () => {
    const last = steps?.at(-1);
    if (!last) return;
    const s = await api.changeLog({ limit: PAGE, before: last.step });
    setSteps((old) => [...(old ?? []), ...s]);
    setMore(s.length === PAGE);
  };

  const toggle = (step: number) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (!next.delete(step)) next.add(step);
      return next;
    });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(760px,94vw)] -translate-1/2 flex-col rounded-xl border border-line bg-panel p-5 shadow-2xl"
          data-testid="change-log"
        >
          <div className="mb-1 flex items-center">
            <Dialog.Title className="text-base font-semibold">Änderungsprotokoll</Dialog.Title>
            <span className="flex-1" />
            <CloseButton onClick={() => onOpenChange(false)} />
          </div>
          <Dialog.Description className="mb-3 text-[0.86rem] text-muted">
            Jede Änderung an diesem Projekt, die neueste oben, mit den Werten vorher und nachher. Das Protokoll steht in
            der Projektdatei und bleibt auch nach Rückgängig erhalten.
          </Dialog.Description>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line">
            {steps === null && <p className="p-3 text-[0.9rem] text-muted">Wird geladen…</p>}
            {steps?.length === 0 && <p className="p-3 text-[0.9rem] text-muted">Noch keine Änderungen.</p>}
            {steps?.map((s) => {
              const isOpen = expanded.has(s.step);
              return (
                <div key={s.step} className="border-b border-line last:border-b-0" data-testid="change-step">
                  <button
                    className="flex w-full cursor-pointer items-baseline gap-3 px-3 py-2 text-left hover:bg-sunken"
                    aria-expanded={isOpen}
                    onClick={() => toggle(s.step)}
                  >
                    <span className="w-3 flex-none text-muted" aria-hidden>
                      {isOpen ? "▾" : "▸"}
                    </span>
                    <span className="w-40 flex-none text-[0.84rem] text-muted tabular-nums">{when(s.at)}</span>
                    <span
                      className={cx(
                        "min-w-0 flex-1",
                        isOpen ? "[overflow-wrap:anywhere]" : "truncate",
                        !s.label && "text-muted italic",
                      )}
                    >
                      {s.label ?? "Ohne Beschriftung (z. B. Einsammeln)"}
                    </span>
                    <span className="flex-none text-[0.82rem] text-muted">
                      {s.changes.length === 1 ? "1 Änderung" : `${s.changes.length} Änderungen`}
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="grid gap-2 px-3 pb-3 pl-9 text-[0.84rem]">
                      {s.changes.map((c, i) => {
                        const fields = fieldChanges(c);
                        return (
                          <li key={i}>
                            <div className="font-medium">
                              {TABLE_LABEL[c.table] ?? c.table} {OP_LABEL[c.op]}
                              <span className="ml-2 font-normal text-muted">#{c.rowKey}</span>
                            </div>
                            {fields.length > 0 && (
                              <table className="mt-0.5 w-full table-fixed border-collapse">
                                <tbody>
                                  {fields.map((f) => (
                                    <tr key={f.field} className="align-top">
                                      <td className="w-36 pr-2 text-muted [overflow-wrap:anywhere]" title={f.field}>
                                        {FIELD_LABEL[f.field] ?? f.field}
                                      </td>
                                      {c.op !== "insert" && (
                                        <td className="pr-2 break-words line-through decoration-muted/60">
                                          {showValue(f.before, 80, f.field)}
                                        </td>
                                      )}
                                      {c.op !== "delete" && (
                                        <td className="break-words">{showValue(f.after, 80, f.field)}</td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
            {more && (
              <div className="p-2 text-center">
                <Button size="sm" onClick={() => void loadOlder()}>
                  Ältere laden
                </Button>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[0.84rem] text-muted" title={saved ?? undefined}>
              {saved && `Gespeichert: ${saved}`}
            </span>
            <Button onClick={() => void api.exportChangeLog().then((p) => p && setSaved(p))}>Als CSV speichern…</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
