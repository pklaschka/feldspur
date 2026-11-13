/** Schnellsuche (Strg/⌘+K): Mitschrift, Tagebuch, Quellen und Episoden eines Einsatzes. */
import { formatClock } from "@feldspur/core/time";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionView } from "../shared/api.ts";
import { highlight, search, searchItems, type Hit } from "./search.ts";
import { usePlayback } from "./playback.tsx";
import { cx } from "./ui.tsx";

const KIND_LABEL: Record<Hit["kind"], string> = {
  line: "Mitschrift",
  diary: "Tagebuch",
  source: "Quelle",
  episode: "Episode",
};

export function SearchDialog({
  view,
  open,
  onOpenChange,
  onPick,
}: {
  view: SessionView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (hit: Hit) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const items = useMemo(() => searchItems(view), [view]);
  const hits = useMemo(() => search(items, query), [items, query]);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const pick = (h: Hit | undefined) => {
    if (!h) return;
    onPick(h);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[min(40rem,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          data-testid="search"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Suchen</Dialog.Title>
          <input
            autoFocus
            className="m-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[0.95rem]"
            placeholder="Mitschrift, Tagebuch, Quellen, Uhrzeit (z. B. 10:15) …"
            aria-label="Suchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(hits.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(hits[active]);
              }
            }}
          />
          <ul
            ref={list}
            className="overflow-y-auto border-t border-line px-1.5 py-1.5"
            role="listbox"
            aria-label="Treffer"
          >
            {query.trim() && !hits.length && <li className="px-3 py-3 text-[0.85rem] text-muted">Nichts gefunden.</li>}
            {!query.trim() && (
              <li className="px-3 py-3 text-[0.85rem] text-muted">
                {items.length} Einträge durchsuchbar. Mehrere Wörter: alle müssen vorkommen. ↑↓ wählen, Enter springt
                hin.
              </li>
            )}
            {hits.map((h, i) => (
              <li
                key={`${h.kind}:${h.target}:${h.atMs ?? ""}:${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                className={cx(
                  "grid cursor-pointer grid-cols-[4.2rem_1fr] gap-x-3 rounded-lg px-2.5 py-1.5",
                  i === active && "bg-accent-soft",
                )}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(h)}
              >
                <span className="pt-0.5 font-mono text-[0.78rem] text-muted">
                  {h.clockMs === null ? "–" : formatClock(h.clockMs)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.78rem] text-muted">
                    {KIND_LABEL[h.kind]} · {h.title}
                  </span>
                  <span className="line-clamp-2 text-[0.88rem]">
                    {highlight(h.text, query).map((p, j) =>
                      p.hit ? (
                        <mark key={j} className="rounded-sm bg-accent-soft text-ink">
                          {p.text}
                        </mark>
                      ) : (
                        <span key={j}>{p.text}</span>
                      ),
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Suchdialog samt Sprung zur Fundstelle (braucht den PlaybackProvider). */
export function QuickSearch({
  view,
  open,
  onOpenChange,
  onSource,
  onDiary,
  onReview,
}: {
  view: SessionView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSource: (id: string) => void;
  onDiary: (pageId: string) => void;
  onReview: () => void;
}) {
  const { seek } = usePlayback();
  const pick = (h: Hit) => {
    if (h.kind === "diary") return h.target ? onDiary(h.target) : undefined;
    if (h.kind === "episode") return onReview();
    onSource(h.target);
    if (h.kind === "line") {
      onReview();
      if (h.atMs !== undefined) seek(h.target, h.atMs);
    }
  };
  return <SearchDialog view={view} open={open} onOpenChange={onOpenChange} onPick={pick} />;
}
