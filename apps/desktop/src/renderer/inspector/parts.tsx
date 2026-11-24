/** Kleine Bausteine der Detailleiste (`apps/desktop/src/renderer/Inspector.tsx`). */
import type { ReactNode } from "react";
import { cx } from "../ui.tsx";

/** Liste aus Bezeichnung und Wert; das dritte Element eines Eintrags ist eine CSS-Klasse für den Wert. */
export function KV({ items, small }: { items: [string, ReactNode, string?][]; small?: boolean }) {
  return (
    <dl className={cx("mt-3.5 grid grid-cols-[6.5rem_1fr] gap-x-2.5 gap-y-1", small && "text-[0.85rem]")}>
      {items.map(([k, v, cls]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className={cx("min-w-0", cls)}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Eingeklappter Abschnitt für Nachschlage-Angaben (Datei, Stille). */
export function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group mt-5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[1rem] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-[0.8rem] text-muted transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="font-serif">{title}</span>
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}
