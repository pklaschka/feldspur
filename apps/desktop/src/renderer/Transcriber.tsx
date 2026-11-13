/**
 * Mitschreiben: eine Ton- oder Videoquelle abhören und von Hand mittippen.
 * Enter legt eine Zeile an; ihre Zeitmarke ist die Stelle, an der du angefangen hast zu tippen.
 * Gespeichert wird die Stelle in der Aufnahme, die Uhrzeit ergibt sich aus dem Abgleich.
 */
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { mediaUrl, type SessionView, type SourceRow, type TranscriptRow } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { clock, KIND_LABEL, splitSpeaker } from "./format.ts";
import { positionText, usePlayback } from "./playback.tsx";
import { Button, Choice, CloseButton, cx, Glyph, Picker } from "./ui.tsx";

const api = window.feldspur;

const SPEEDS = ["0.5", "0.75", "1", "1.25", "1.5"] as const;
type Speed = (typeof SPEEDS)[number];
/** Beim Fortsetzen ein Stück zurück, damit kein Wort verloren geht. */
const RESUME_BACK_MS = 1000;
const JUMP_MS = 5000;

interface Event {
  key: string;
  atMs: number;
  text: string;
}

export function Transcriber({
  view,
  sourceId,
  onSource,
  onClose,
  guard,
  onView,
}: {
  view: SessionView;
  /** Abgehörte Quelle; null = geschlossen. */
  sourceId: string | null;
  onSource: (id: string) => void;
  onClose: () => void;
  guard: Guard;
  onView: (v: SessionView) => void;
}) {
  const row = sourceId ? view.rows.find((r) => r.id === sourceId) : undefined;
  const avRows = view.rows.filter((r) => r.kind === "audio" || r.kind === "video");
  return (
    <Dialog.Root open={!!row} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          aria-describedby={undefined}
          data-testid="transcriber"
          // Esc hält die Wiedergabe an, statt den Dialog zu schließen.
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {row && (
            <Body
              key={row.id}
              view={view}
              row={row}
              avRows={avRows}
              onSource={onSource}
              onClose={onClose}
              guard={guard}
              onView={onView}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({
  view,
  row,
  avRows,
  onSource,
  onClose,
  guard,
  onView,
}: {
  view: SessionView;
  row: SourceRow;
  avRows: SourceRow[];
  onSource: (id: string) => void;
  onClose: () => void;
  guard: Guard;
  onView: (v: SessionView) => void;
}) {
  const { position, seek } = usePlayback();
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState(position?.sourceId === row.id ? position.atMs : 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [speaker, setSpeaker] = useState("");
  /** Stelle beim ersten Tastendruck der neuen Zeile. */
  const [mark, setMark] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const lines = view.transcript.filter((l) => l.sourceId === row.id);
  const speakers = [...new Set(view.transcript.map((l) => l.speaker).filter(Boolean))].sort();
  const events = useMemo(() => eventsIn(view, row), [view, row]);
  const items = [
    ...lines.map((l) => ({ kind: "line" as const, atMs: l.atMs, line: l })),
    ...events.map((e) => ({ kind: "event" as const, atMs: e.atMs, event: e })),
  ].sort((a, b) => a.atMs - b.atMs || (a.kind === "event" ? -1 : 1));
  const current = lines.filter((l) => l.atMs <= pos).at(-1)?.id;

  // Stelle flüssig nachführen.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (media.current) setPos(Math.round(media.current.currentTime * 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const el = media.current;
    return () => {
      cancelAnimationFrame(raf);
      // Stelle an die Detailleiste zurückgeben.
      if (el) seek(row.id, Math.round(el.currentTime * 1000));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);
  useEffect(() => {
    if (media.current) media.current.playbackRate = Number(speed);
  }, [speed]);
  useEffect(() => input.current?.focus(), []);

  const seekTo = (ms: number) => {
    const el = media.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms) / 1000;
    setPos(Math.round(el.currentTime * 1000));
  };
  const toggle = () => {
    const el = media.current;
    if (!el) return;
    if (el.paused) {
      seekTo(el.currentTime * 1000 - RESUME_BACK_MS);
      // Ein sofortiges Anhalten bricht play() ab; das ist kein Fehler der Datei.
      void el.play().catch(() => {});
    } else el.pause();
  };
  const nextSpeed = (dir: 1 | -1) => {
    const i = SPEEDS.indexOf(speed) + dir;
    if (i >= 0 && i < SPEEDS.length) setSpeed(SPEEDS[i]!);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      toggle();
    } else if (e.key === "F8") {
      e.preventDefault();
      seekTo(pos - JUMP_MS);
    } else if (e.key === "F9") {
      e.preventDefault();
      seekTo(pos + JUMP_MS);
    } else if (e.key === "F7") {
      e.preventDefault();
      nextSpeed(e.shiftKey ? 1 : -1);
    }
  };

  const commit = async () => {
    const { speaker: sp, text } = splitSpeaker(draft);
    if (!text.trim()) return;
    const who = sp ?? speaker;
    const atMs = mark ?? pos;
    const res = await guard(() => api.addTranscriptLine(row.id, { atMs, speaker: who, text }));
    if (!res) return;
    onView(res.view);
    setSpeaker(who);
    setDraft("");
    setMark(null);
    requestAnimationFrame(() => list.current?.lastElementChild?.scrollIntoView({ block: "nearest" }));
  };

  const patch = (id: string, p: Partial<Pick<TranscriptRow, "atMs" | "speaker" | "text">>) =>
    void guard(() => api.updateTranscriptLine(id, p)).then((v) => v && onView(v));
  const remove = (id: string) => void guard(() => api.deleteTranscriptLine(id)).then((v) => v && onView(v));

  const at = (ms: number) => (
    <>
      {positionText(ms)}
      {row.startMs !== null && <span className="text-muted"> · {clock(row.startMs + ms)}</span>}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDownCapture={onKey}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <Glyph kind={row.kind} />
        <Dialog.Title className="text-base font-semibold">Mitschreiben</Dialog.Title>
        <Picker
          label="Tonquelle"
          placeholder="Tonquelle wählen"
          value={row.id}
          onChange={onSource}
          options={avRows.map((r) => ({ value: r.id, label: `${r.label} · ${r.fileName}` }))}
          className="w-72"
        />
        <span className="text-[0.8rem] text-muted">
          {lines.length} {lines.length === 1 ? "Zeile" : "Zeilen"}
        </span>
        <span className="flex-1" />
        <Button size="sm" onClick={onClose}>
          Fertig
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,38%)]">
        <section className="flex min-h-0 flex-col border-r border-line">
          <ol
            ref={list}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
            aria-label="Mitschrift"
            data-testid="lines"
          >
            {items.length === 0 && (
              <li className="py-6 text-center text-[0.85rem] text-muted">
                Noch nichts mitgeschrieben. Starte die Wiedergabe mit Esc und tippe unten mit. Enter legt die Zeile an.
              </li>
            )}
            {items.map((it) =>
              it.kind === "event" ? (
                <li
                  key={it.event.key}
                  className="my-1 flex items-baseline gap-3 rounded-md bg-panel-2 px-2 py-1 text-[0.8rem] text-ink-2"
                  data-testid="event"
                >
                  <button
                    className="w-36 flex-none cursor-pointer text-left font-mono hover:text-accent"
                    onClick={() => seekTo(it.atMs)}
                  >
                    {at(it.atMs)}
                  </button>
                  <span>▪ {it.event.text}</span>
                </li>
              ) : (
                <Line
                  key={it.line.id}
                  line={it.line}
                  current={it.line.id === current}
                  at={at(it.line.atMs)}
                  onSeek={() => seekTo(it.line.atMs)}
                  onRetime={() => patch(it.line.id, { atMs: pos })}
                  onPatch={(p) => patch(it.line.id, p)}
                  onRemove={() => remove(it.line.id)}
                />
              ),
            )}
          </ol>
          <form
            className="flex items-center gap-2 border-t border-line bg-panel-2 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <span className="w-24 flex-none font-mono text-[0.78rem] text-muted" title="Zeitmarke der neuen Zeile">
              {positionText(mark ?? pos)}
            </span>
            <input
              className="w-16 flex-none font-mono"
              aria-label="Sprecher"
              placeholder="Kürzel"
              list="feldspur-speakers"
              value={speaker}
              onChange={(e) => setSpeaker(e.target.value)}
            />
            <datalist id="feldspur-speakers">
              {speakers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <input
              ref={input}
              className="min-w-0 flex-1"
              aria-label="Neue Zeile"
              placeholder="Mittippen, Enter für die nächste Zeile. „B1: …“ wechselt den Sprecher."
              value={draft}
              onChange={(e) => {
                if (mark === null && e.target.value) setMark(pos);
                if (!e.target.value) setMark(null);
                setDraft(e.target.value);
              }}
            />
            <Button variant="primary" size="sm" type="submit" disabled={!draft.trim()}>
              Zeile anlegen
            </Button>
          </form>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          {failed ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[0.8rem] text-warn">
              Diese Datei lässt sich hier nicht abspielen (Format oder Codec).
            </p>
          ) : row.kind === "video" ? (
            <video
              ref={media}
              src={mediaUrl(row.id)}
              preload="auto"
              className="block max-h-[45vh] w-full rounded-lg bg-black"
              onLoadedMetadata={() => seekTo(pos)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setFailed(true)}
              data-testid="transcriber-media"
            />
          ) : (
            <audio
              ref={media}
              src={mediaUrl(row.id)}
              preload="auto"
              onLoadedMetadata={() => seekTo(pos)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setFailed(true)}
              data-testid="transcriber-media"
            />
          )}
          <div className="rounded-lg border border-line p-3">
            <div className="font-mono text-xl" data-testid="transcriber-position">
              {positionText(pos)}
              {row.startMs !== null && <span className="ml-2 text-base text-ink-2">{clock(row.startMs + pos)}</span>}
            </div>
            <Scrubber row={row} pos={pos} lines={lines} events={events} onSeek={seekTo} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => seekTo(pos - JUMP_MS)} title="F8">
                −5 s
              </Button>
              <Button size="sm" variant="primary" onClick={toggle} className="w-24" title="Esc">
                {playing ? "Pause" : "Abspielen"}
              </Button>
              <Button size="sm" onClick={() => seekTo(pos + JUMP_MS)} title="F9">
                +5 s
              </Button>
              <Choice
                label="Tempo"
                value={speed}
                onChange={setSpeed}
                options={SPEEDS.map((s) => ({ value: s, label: `${s.replace(".", ",")}×` }))}
              />
            </div>
          </div>
          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-[0.8rem]">
            <dt className="font-mono font-medium">Esc</dt>
            <dd>Abspielen / anhalten (springt beim Fortsetzen 1 s zurück)</dd>
            <dt className="font-mono font-medium">F8 / F9</dt>
            <dd>5 s zurück / vor</dd>
            <dt className="font-mono font-medium">F7</dt>
            <dd>langsamer (mit Umschalt schneller)</dd>
            <dt className="font-mono font-medium">Enter</dt>
            <dd>Zeile anlegen. Die Zeitmarke ist die Stelle, an der du angefangen hast zu tippen.</dd>
            <dt className="font-mono font-medium">B1: …</dt>
            <dd>Sprecher wechseln, wenn die Zeile so beginnt</dd>
          </dl>
          <p className="text-[0.8rem] text-muted">
            Jede Zeile speichert die Stelle in {row.label}. Die Uhrzeit folgt dem Abgleich, auch wenn du ihn später
            änderst. ▪ Zeilen zeigen, was gleichzeitig in anderen Quellen passiert.
          </p>
          {row.kind === "video" && (
            <p className="text-[0.8rem] text-muted">{KIND_LABEL.video}: Ton und Bild aus der Datei.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Line({
  line,
  current,
  at,
  onSeek,
  onRetime,
  onPatch,
  onRemove,
}: {
  line: TranscriptRow;
  current: boolean;
  at: React.ReactNode;
  onSeek: () => void;
  onRetime: () => void;
  onPatch: (p: { speaker?: string; text?: string }) => void;
  onRemove: () => void;
}) {
  const [speaker, setSpeaker] = useState(line.speaker);
  const [text, setText] = useState(line.text);
  useEffect(() => setSpeaker(line.speaker), [line.speaker]);
  useEffect(() => setText(line.text), [line.text]);
  return (
    <li
      className={cx(
        "group flex items-baseline gap-3 rounded-md px-2 py-0.5",
        current ? "bg-accent-soft" : "hover:bg-panel-2",
      )}
      data-testid="line"
    >
      <button
        className="w-36 flex-none cursor-pointer text-left font-mono text-[0.8rem] hover:text-accent"
        onClick={onSeek}
        title="Hierhin springen"
      >
        {at}
      </button>
      <input
        className="w-14 flex-none border-transparent bg-transparent font-mono font-medium hover:border-line focus:border-line-2"
        aria-label="Sprecher der Zeile"
        value={speaker}
        onChange={(e) => setSpeaker(e.target.value)}
        onBlur={() => speaker !== line.speaker && onPatch({ speaker })}
      />
      <input
        className="min-w-0 flex-1 border-transparent bg-transparent hover:border-line focus:border-line-2"
        aria-label="Text der Zeile"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== line.text && onPatch({ text })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span className="flex flex-none gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <Button size="sm" variant="link" onClick={onRetime} title="Zeitmarke auf die aktuelle Stelle setzen">
          Zeit hierher
        </Button>
        <CloseButton label="Zeile löschen" onClick={onRemove} />
      </span>
    </li>
  );
}

/** Schmale Leiste über die ganze Aufnahme: Zeilen als Striche, Ereignisse als Punkte, Klick spult. */
function Scrubber({
  row,
  pos,
  lines,
  events,
  onSeek,
}: {
  row: SourceRow;
  pos: number;
  lines: TranscriptRow[];
  events: Event[];
  onSeek: (ms: number) => void;
}) {
  const dur = row.durationMs ?? 0;
  if (!dur) return null;
  const pct = (ms: number) => `${Math.min(100, (ms / dur) * 100)}%`;
  return (
    <div
      className="relative mt-2 h-6 cursor-pointer rounded bg-sunken"
      onClick={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - b.left) / b.width) * dur);
      }}
      role="slider"
      aria-label="Stelle in der Aufnahme"
      aria-valuemin={0}
      aria-valuemax={dur}
      aria-valuenow={pos}
      aria-valuetext={positionText(pos)}
      tabIndex={-1}
    >
      {lines.map((l) => (
        <span key={l.id} className="absolute top-1 h-4 w-px bg-accent/60" style={{ left: pct(l.atMs) }} />
      ))}
      {events.map((e) => (
        <span
          key={e.key}
          className="absolute top-2 size-2 -translate-x-1 rounded-full bg-muted"
          style={{ left: pct(e.atMs) }}
        />
      ))}
      <span className="absolute top-0 h-6 w-0.5 bg-bad" style={{ left: pct(pos) }} />
    </div>
  );
}

/** Was in anderen Quellen passiert, während diese Aufnahme läuft (als Stelle in dieser Aufnahme). */
function eventsIn(view: SessionView, row: SourceRow): Event[] {
  if (row.startMs === null) return [];
  const start = row.startMs;
  const end = row.endMs ?? start + (row.durationMs ?? 0);
  const inside = (ms: number | null) => ms !== null && ms >= start && ms <= end;
  const out: Event[] = [];
  for (const r of view.rows) {
    if (r.id === row.id || r.partOf || r.kind === "diary" || !inside(r.startMs)) continue;
    const what =
      r.kind === "video"
        ? `${r.label} (Video) beginnt`
        : r.kind === "audio"
          ? `${r.label} (Audio) beginnt`
          : `${KIND_LABEL[r.kind]} ${r.label}`;
    out.push({ key: `r:${r.id}`, atMs: r.startMs! - start, text: `${what} · ${r.fileName}` });
  }
  for (const d of view.diary) {
    if (!d.window || !inside(d.window.fromMs)) continue;
    const short = d.shortText || d.fullText;
    out.push({
      key: `d:${d.id}`,
      atMs: d.window.fromMs - start,
      text: `Tagebuch ${d.regions[0]?.pageLabel ?? ""}, Eintrag ${d.number}${d.notedAt ? ` (notiert ${d.notedAt})` : ""}${short ? `: ${short}` : ""}`,
    });
  }
  return out;
}
