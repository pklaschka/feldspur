/** Eine Zeile der Mitschrift: Stelle, Sprecher*in, Text. */
import { memo, useRef } from "react";
import type { TranscriptRow } from "../../shared/api.ts";
import { clock } from "../format.ts";
import { positionText } from "../playback.tsx";
import { leadingSpeaker, oneParagraph } from "../transcribe.ts";
import { Button, CloseButton, cx } from "../ui.tsx";
import { useDraft } from "../hooks.ts";

export function At({ ms, startMs }: { ms: number; startMs: number | null }) {
  return (
    <>
      {positionText(ms)}
      {startMs !== null && <span className="text-muted"> · {clock(startMs + ms)}</span>}
    </>
  );
}
export interface LineActions {
  seek: (ms: number) => void;
  retime: (id: string) => void;
  patch: (id: string, p: { speaker?: string; text?: string }) => void;
  remove: (id: string) => void;
  split: (line: TranscriptRow, cursor: number) => void | Promise<void>;
}

export const Line = memo(function Line({
  line,
  current,
  startMs,
  actions,
}: {
  line: TranscriptRow;
  current: boolean;
  startMs: number | null;
  actions: LineActions;
}) {
  const [speaker, setSpeaker] = useDraft(line.speaker);
  const [text, setText] = useDraft(line.text);
  /** Beim Teilen springt der Fokus in die neue Zeile; der alte Text darf dabei nicht zurückgeschrieben werden. */
  const splitting = useRef(false);
  return (
    <li
      className={cx(
        "group flex items-start gap-3 rounded-md px-2 py-0.5 [contain-intrinsic-size:auto_2rem] [content-visibility:auto]",
        current ? "bg-accent-soft" : "hover:bg-panel-2",
      )}
      data-testid="line"
      data-line={line.id}
    >
      <button
        className="w-36 flex-none cursor-pointer pt-1 text-left font-mono text-[0.85rem] hover:text-accent"
        onClick={() => actions.seek(line.atMs)}
        title="Hierhin springen"
      >
        <At ms={line.atMs} startMs={startMs} />
      </button>
      <input
        className="w-14 flex-none border-transparent bg-transparent font-mono font-medium hover:border-line focus:border-line-2"
        aria-label="Sprecher der Zeile"
        value={speaker}
        onChange={(e) => setSpeaker(e.target.value)}
        onBlur={() => speaker !== line.speaker && actions.patch(line.id, { speaker })}
      />
      <textarea
        rows={1}
        className="min-w-0 flex-1 resize-none border-transparent bg-transparent [field-sizing:content] hover:border-line focus:border-line-2"
        aria-label="Text der Zeile"
        value={text}
        onChange={(e) => setText(oneParagraph(e.target.value))}
        onBlur={() => {
          if (splitting.current) splitting.current = false;
          else {
            // „B1: …“ am Anfang einer bestehenden Zeile setzt deren Sprecher.
            const lead = leadingSpeaker(text);
            if (lead) {
              setSpeaker(lead.speaker);
              setText(lead.rest);
              actions.patch(line.id, { speaker: lead.speaker, text: lead.rest });
            } else if (text !== line.text) actions.patch(line.id, { text });
          }
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          const el = e.currentTarget;
          if (e.metaKey || e.ctrlKey) {
            // Erst die Änderungen dieser Zeile übernehmen, dann teilen.
            const cursor = el.selectionStart;
            const first = text.slice(0, cursor).trim();
            if (!first || !text.slice(cursor).trim()) return;
            splitting.current = true;
            setText(first);
            void actions.split({ ...line, text }, cursor);
          } else el.blur();
        }}
      />
      <span className="flex flex-none gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          size="sm"
          variant="link"
          onClick={() => actions.retime(line.id)}
          title="Zeitmarke auf die aktuelle Stelle setzen"
        >
          Zeit hierher
        </Button>
        <CloseButton label="Zeile löschen" confirm={!!line.text.trim()} onClick={() => actions.remove(line.id)} />
      </span>
    </li>
  );
});
