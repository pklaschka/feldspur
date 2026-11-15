/**
 * Arbeitsnotizen zu einer Datei: „ab 12:30 noch abtippen“, „B2 schwer verständlich“.
 * Mit Strecke in der Aufnahme oder für die ganze Datei. Erscheint in der Detailleiste und beim
 * Mitschreiben (dort auch als Band in der Waveform).
 */
import { useEffect, useState } from "react";
import type { SessionView, SourceNoteRow, SourceRow } from "../shared/api.ts";
import { positionText } from "./playback.tsx";
import { Button, CloseButton, cx } from "./ui.tsx";

const api = window.feldspur;

export type ApplyView = (fn: () => Promise<SessionView>) => void;

const AV = new Set(["audio", "video"]);

export function noteRange(n: Pick<SourceNoteRow, "fromMs" | "toMs">): string {
  if (n.fromMs === null) return "ganze Datei";
  if (n.toMs === null) return `bei ${positionText(n.fromMs)}`;
  return `${positionText(n.fromMs)} – ${positionText(n.toMs)}`;
}

export function NotesPanel({
  row,
  notes,
  pos,
  apply,
  onSeek,
  compact,
}: {
  row: SourceRow;
  notes: SourceNoteRow[];
  /** Aktuelle Stelle in der Aufnahme; ohne sie lassen sich keine Strecken setzen. */
  pos?: number | null;
  apply: ApplyView;
  onSeek?: (ms: number) => void;
  compact?: boolean;
}) {
  const av = AV.has(row.kind) && pos !== undefined && pos !== null;
  const [text, setText] = useState("");
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const open = notes.filter((n) => !n.done).length;

  const add = () => {
    if (!text.trim()) return;
    apply(() => api.addSourceNote(row.id, { text, fromMs: from, toMs: from === null ? null : to }));
    setText("");
    setFrom(null);
    setTo(null);
  };

  return (
    <section className="rounded-lg border border-line p-3" data-testid="notes" aria-label="Notizen zu dieser Datei">
      <h3 className="mb-1.5 flex items-baseline gap-2 text-[0.85rem] font-semibold">
        Notizen zu dieser Datei
        {notes.length > 0 && (
          <span className="text-[0.78rem] font-normal text-muted">
            {open} offen{notes.length > open ? `, ${notes.length - open} erledigt` : ""}
          </span>
        )}
      </h3>
      {notes.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {notes.map((n) => (
            <NoteItem key={n.id} note={n} apply={apply} onSeek={onSeek} />
          ))}
        </ul>
      )}
      <textarea
        className="block w-full resize-none [field-sizing:content]"
        rows={compact ? 1 : 2}
        aria-label="Neue Notiz"
        placeholder={av ? "z. B. „ab hier noch abtippen, zwei Stimmen durcheinander“" : "Notiz zu dieser Datei"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            add();
          }
        }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.8rem]">
        {av && (
          <>
            <Button size="sm" onClick={() => setFrom(pos)} title="Beginn der Strecke auf die aktuelle Stelle setzen">
              {from === null ? "Beginn hier" : `ab ${positionText(from)}`}
            </Button>
            <Button
              size="sm"
              disabled={from === null}
              onClick={() => setTo(pos)}
              title="Ende der Strecke auf die aktuelle Stelle setzen"
            >
              {to === null ? "Ende hier" : `bis ${positionText(to)}`}
            </Button>
            {from !== null && (
              <Button
                size="sm"
                variant="link"
                onClick={() => {
                  setFrom(null);
                  setTo(null);
                }}
              >
                ganze Datei
              </Button>
            )}
          </>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="primary" disabled={!text.trim()} onClick={add} title="Strg/⌘+Enter">
          Notiz anlegen
        </Button>
      </div>
    </section>
  );
}

function NoteItem({
  note,
  apply,
  onSeek,
}: {
  note: SourceNoteRow;
  apply: ApplyView;
  onSeek: ((ms: number) => void) | undefined;
}) {
  const [text, setText] = useState(note.text);
  useEffect(() => setText(note.text), [note.text]);
  return (
    <li
      className={cx("group flex items-start gap-2 rounded-md px-1 py-0.5", note.done && "opacity-60")}
      data-testid="note"
    >
      <input
        type="checkbox"
        className="mt-1.5 flex-none"
        checked={note.done}
        aria-label={note.done ? "Wieder offen" : "Erledigt"}
        title={note.done ? "Wieder offen" : "Erledigt"}
        onChange={(e) => apply(() => api.updateSourceNote(note.id, { done: e.target.checked }))}
      />
      <div className="min-w-0 flex-1">
        {note.fromMs !== null && onSeek ? (
          <button
            type="button"
            className="cursor-pointer font-mono text-[0.75rem] text-warn hover:text-accent"
            onClick={() => onSeek(note.fromMs!)}
            title="Hierhin springen"
          >
            {noteRange(note)}
          </button>
        ) : (
          <span className="font-mono text-[0.75rem] text-muted">{noteRange(note)}</span>
        )}
        <textarea
          className={cx(
            "block w-full resize-none border-transparent bg-transparent px-0 py-0 text-[0.85rem] [field-sizing:content] hover:border-line focus:border-line-2",
            note.done && "line-through",
          )}
          rows={1}
          aria-label="Text der Notiz"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() && text !== note.text && apply(() => api.updateSourceNote(note.id, { text }))}
        />
      </div>
      <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <CloseButton label="Notiz löschen" onClick={() => apply(() => api.deleteSourceNote(note.id))} />
      </span>
    </li>
  );
}
