/**
 * Zuletzt geöffnete Projekte: Liste auf dem Startbildschirm und Projektmenü in der Seitenleiste.
 */
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import type { RecentProject } from "../shared/api.ts";
import { cx } from "./ui.tsx";

const api = window.feldspur;

function useRecent(reload: unknown): [RecentProject[], (l: RecentProject[]) => void] {
  const [list, setList] = useState<RecentProject[]>([]);
  useEffect(() => {
    let live = true;
    void api.recentProjects().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [reload]);
  return [list, setList];
}

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `heute ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
};

/** Liste für den Startbildschirm. */
export function RecentList({ onOpen }: { onOpen: (path: string) => void }) {
  const [list, setList] = useRecent(null);
  if (!list.length) return null;
  return (
    <section className="mt-6" aria-label="Zuletzt geöffnet">
      <div className="mb-1.5 text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">Zuletzt geöffnet</div>
      <ul className="-mx-2">
        {list.map((r) => (
          <li key={r.path} className="group flex items-center gap-1">
            <button
              className={cx(
                "min-w-0 flex-1 cursor-pointer rounded-[7px] px-2 py-1.5 text-left hover:bg-sunken disabled:cursor-default disabled:hover:bg-transparent",
              )}
              disabled={r.missing}
              onClick={() => onOpen(r.path)}
              title={r.path}
            >
              <span className={cx("block truncate", r.missing ? "text-muted line-through" : "font-medium")}>
                {r.name}
              </span>
              <span className="block truncate text-[0.75rem] text-muted">
                {r.missing ? "Datei nicht gefunden · " : `${when(r.openedAt)} · `}
                {r.path}
              </span>
            </button>
            <button
              className="grid size-7 flex-none cursor-pointer place-items-center rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100"
              aria-label={`${r.name} aus der Liste entfernen`}
              title="Aus der Liste entfernen (die Datei bleibt)"
              onClick={() => void api.forgetRecent(r.path).then(setList)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ITEM =
  "flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-[0.85rem] outline-none data-[disabled]:cursor-default data-[disabled]:text-muted data-[highlighted]:bg-accent-soft";

/** Projektname in der Seitenleiste als Menü: anderes Projekt öffnen, zuletzt geöffnete, neues. */
export function ProjectMenu({
  name,
  path,
  open,
  onOpenChange,
  onOpenRecent,
  onOpenOther,
  onNew,
}: {
  name: string;
  path: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenRecent: (path: string) => void;
  onOpenOther: () => void;
  onNew: () => void;
}) {
  const [list] = useRecent(open);
  const others = list.filter((r) => r.path !== path);
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger
        className="mt-1 flex w-full cursor-pointer items-center gap-1 rounded px-0 text-left text-[0.8rem] text-muted outline-none hover:text-ink focus-visible:text-ink"
        title={`${path}\nProjekt wechseln (${navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Strg+"}O)`}
      >
        <span className="truncate">{name}</span>
        <span aria-hidden>▾</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 max-w-[26rem] min-w-64 rounded-lg border border-line bg-panel p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-2.5 pt-1 pb-0.5 text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
            Zuletzt geöffnet
          </DropdownMenu.Label>
          {!others.length && (
            <div className="px-2.5 py-1.5 text-[0.85rem] text-muted">Noch keine anderen Projekte.</div>
          )}
          {others.map((r) => (
            <DropdownMenu.Item
              key={r.path}
              className={ITEM}
              disabled={r.missing}
              onSelect={() => onOpenRecent(r.path)}
              title={r.path}
            >
              <span className="min-w-0 flex-1">
                <span className={cx("block truncate", r.missing && "line-through")}>{r.name}</span>
                <span className="block truncate text-[0.72rem] text-muted">
                  {r.missing ? "Datei nicht gefunden" : when(r.openedAt)}
                </span>
              </span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={ITEM} onSelect={onOpenOther}>
            Anderes Projekt öffnen…
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} onSelect={onNew}>
            Neues Projekt…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
