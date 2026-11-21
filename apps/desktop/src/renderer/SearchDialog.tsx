/** Schnellsuche (Strg/⌘+K): Mitschrift, Notizen, Tagebuch, Quellen und Episoden eines Einsatzes. */
import { formatClock } from "@feldspur/core/time";
import { Dialog } from "radix-ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SessionView } from "../shared/api.ts";
import { highlight, search, searchItems, type Hit } from "./search.ts";
import { usePlayback } from "./playback.tsx";
import { cx } from "./ui.tsx";
import { useDraft } from "./hooks.ts";
import { isEnter } from "./keys.js";

const KIND_LABEL: Record<Hit["kind"], string> = {
  line: "Mitschrift",
  note: "Notiz",
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
  // Neue Suche: wieder beim ersten Treffer anfangen.
  const [active, setActive] = useDraft(0, query);
  const items = useMemo(() => searchItems(view), [view]);
  const { hits, total } = useMemo(() => search(items, query), [items, query]);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const hasQuery = query.trim() !== "";
  const list = useRef<HTMLUListElement>(null);
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
            placeholder="Mitschrift, Notizen, Tagebuch, Quellen, Episoden, Uhrzeit (z. B. 10:15)"
            aria-label="Suchen"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={hits.length ? optionId(active) : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(hits.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (isEnter(e)) {
                e.preventDefault();
                pick(hits[active]);
              }
            }}
          />
          <ul
            ref={list}
            id={listId}
            className="overflow-y-auto border-t border-line px-1.5 py-1.5"
            role="listbox"
            aria-label="Treffer"
          >
            {!hasQuery && (
              <li role="presentation" className="px-3 py-3 text-[0.9rem] text-muted">
                {items.length} Einträge durchsuchbar. Mehrere Wörter: alle müssen vorkommen. ↑↓ wählen, Enter springt
                hin.
              </li>
            )}
            {hits.map((h, i) => (
              <li
                key={`${h.kind}:${h.target}:${h.atMs ?? ""}:${i}`}
                id={optionId(i)}
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
                <span className="pt-0.5 font-mono text-[0.82rem] text-muted">
                  {h.clockMs === null ? "–" : formatClock(h.clockMs)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.82rem] text-muted">
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
          <p
            role="status"
            className={cx(
              "border-t border-line px-4 py-1.5 text-[0.82rem] text-muted",
              (!hasQuery || (total > 0 && total <= hits.length)) && "sr-only",
            )}
          >
            {!hasQuery
              ? ""
              : total === 0
                ? "Nichts gefunden."
                : total > hits.length
                  ? `Erste ${hits.length} von ${total} Treffern. Suche eingrenzen, z. B. mit einer Uhrzeit.`
                  : total === 1
                    ? "1 Treffer."
                    : `${total} Treffer.`}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Wohin ein Sprung auf der Zeitachse zielt: eine Uhrzeit oder ein Bereich (Episode). */
export interface Reveal {
  fromMs: number;
  toMs?: number;
}

/**
 * Suchdialog samt Sprung zur Fundstelle (braucht den PlaybackProvider). Jede Trefferart hat ein festes Ziel:
 * - Mitschrift, Notiz (Audio/Video): Mitschreiben öffnen (oder wechseln) und dorthin spulen.
 * - Quelle: Durchsehen, Quelle gewählt und auf der Zeitachse ins Bild geholt.
 * - Episode: Durchsehen, Zeitachse auf die Episode gezoomt.
 * - Tagebuch: Abtippen auf der Seite des Eintrags; ohne Seite die Stelle auf der Zeitachse.
 */
export interface JumpTargets {
  onSource: (id: string) => void;
  onTranscribe: (id: string | null) => void;
  onDiary: (pageId: string | null) => void;
  onReview: () => void;
  onReveal: (r: Reveal) => void;
}

/** Sprung zu einer Fundstelle, wie aus der Suche; auch „Zeigen“ nach Rückgängig nutzt ihn. */
export function useJump(
  view: SessionView,
  t: JumpTargets,
): (h: Pick<Hit, "kind" | "target" | "atMs" | "clockMs" | "endMs">) => void {
  const { seek } = usePlayback();
  return (h) => {
    const row = view.rows.find((r) => r.id === h.target);
    const av = row?.kind === "audio" || row?.kind === "video";
    // Mitschrift-Treffer öffnen das Mitschreiben direkt an der Stelle, auch wenn es noch zu ist.
    if ((h.kind === "line" || h.kind === "note") && av) {
      if (h.atMs !== undefined) seek(h.target, h.atMs);
      t.onTranscribe(h.target);
      return;
    }
    if (h.kind === "diary" && h.target) {
      t.onTranscribe(null);
      t.onDiary(h.target);
      return;
    }
    // Alles andere landet in Durchsehen; offene Fenster schließen, damit man sieht, wohin es geht.
    t.onTranscribe(null);
    t.onDiary(null);
    t.onReview();
    if (h.kind !== "episode" && h.kind !== "diary") t.onSource(h.target);
    if (h.atMs !== undefined) seek(h.target, h.atMs);
    if (h.clockMs !== null) t.onReveal({ fromMs: h.clockMs, toMs: h.endMs });
  };
}

export function QuickSearch({
  view,
  open,
  onOpenChange,
  ...targets
}: {
  view: SessionView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
} & JumpTargets) {
  const pick = useJump(view, targets);
  return <SearchDialog view={view} open={open} onOpenChange={onOpenChange} onPick={pick} />;
}
