/** Detailleiste ohne gewählte Quelle: Stand des Einsatzes und was als Nächstes zu tun ist. */
import type { SessionView, SourceRow } from "../../shared/api.ts";
import { STATUS_TEXT } from "../format.ts";
import { Button, Eyebrow, STATUS_TEXT_CLASS } from "../ui.tsx";
import { type Todo, todos } from "./status.ts";

export function TodoList({ items, onGo }: { items: Todo[]; onGo: (t: Todo) => void }) {
  return (
    <ul className="grid gap-1.5">
      {items.map((t) => (
        <li key={t.text} className="flex flex-wrap items-baseline gap-x-2">
          <span>{t.text}</span>
          <Button variant="link" className="text-[0.88rem]" onClick={() => onGo(t)}>
            {t.action} →
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** compact: nur der Stand (in Ausgeben stehen die offenen Punkte schon vor dem Knopf). */
export function Summary({ view, onGo, compact }: { view: SessionView; onGo: (t: Todo) => void; compact?: boolean }) {
  const count = (s: SourceRow["status"]) => view.rows.filter((r) => r.status === s).length;
  const todo = todos(view);
  const total = view.rows.length;
  const parts = (["ok", "check", "unplaced"] as const).filter((st) => count(st) > 0);
  return (
    <>
      <Eyebrow className="mt-0">Stand des Einsatzes</Eyebrow>
      {total > 0 && (
        <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
          {parts.map((st) => (
            <span key={st} className={STATUS_BAR[st]} style={{ width: `${(count(st) / total) * 100}%` }} />
          ))}
        </div>
      )}
      <p className="mt-2 text-[0.92rem]">
        {total === 0
          ? "Noch keine Quellen."
          : (["ok", "check", "unplaced"] as const).map((st, i) => (
              <span key={st} className={count(st) ? STATUS_TEXT_CLASS[st] : "text-muted"}>
                {i > 0 && <span className="text-muted"> · </span>}
                <b className="font-semibold">{count(st)}</b> {STATUS_TEXT[st]}
              </span>
            ))}
      </p>
      {!compact && <Eyebrow>Als Nächstes</Eyebrow>}
      {compact ? null : todo.length ? (
        <TodoList items={todo} onGo={onGo} />
      ) : (
        <p className="text-[0.9rem]">
          <span className="text-good">Alles verortet und geprüft.</span>{" "}
          <Button variant="link" onClick={() => onGo({ text: "", step: "export", action: "" })}>
            Bereit zum Ausgeben →
          </Button>
        </p>
      )}
      {!compact && (
        <p className="mt-6 text-[0.85rem] text-muted">
          Wähle eine Quelle aus, um Vorschau, Zeitbelege und Dateiangaben zu sehen.
        </p>
      )}
    </>
  );
}

export const STATUS_BAR = { ok: "bg-good/70", check: "bg-warn", unplaced: "bg-bad" } as const;
