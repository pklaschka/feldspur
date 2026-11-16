/**
 * Mitschreiben: eine Ton- oder Videoquelle abhören und von Hand mittippen.
 * Enter legt eine Zeile an; ihre Zeitmarke ist die Stelle, an der du angefangen hast zu tippen.
 * Gespeichert wird die Stelle in der Aufnahme, die Uhrzeit ergibt sich aus dem Abgleich.
 *
 * Für lange Mitschriften: Die Liste zeichnet Zeilen nur neu, wenn sie sich ändern (nicht bei jedem
 * Bild der Wiedergabe), Textfelder wachsen mit, und die Liste läuft der Wiedergabe nach.
 */
import { Dialog } from "radix-ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mediaUrl, type SessionView, type SourceNoteRow, type SourceRow, type TranscriptRow } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { clock, KIND_LABEL, splitSpeaker } from "./format.ts";
import { NotesPanel } from "./Notes.tsx";
import { positionText, usePlayback } from "./playback.tsx";
import { leadingSpeaker, oneParagraph, splitLine, transcriberKey, waveWindow } from "./transcribe.ts";
import { Button, Choice, CloseButton, cx, Glyph, Picker, Toggle } from "./ui.tsx";
import { usePeakTiles, Waveform, type WaveBand, type WaveMarker } from "./Waveform.tsx";
import { LEVEL_MEDIA_PROPS, useLevel } from "./level.ts";

const api = window.feldspur;

const SPEEDS = ["0.5", "0.75", "1", "1.25", "1.5"] as const;
type Speed = (typeof SPEEDS)[number];
/** Beim Fortsetzen ein Stück zurück, damit kein Wort verloren geht. */
const RESUME_BACK_MS = 1000;
const JUMP_MS = 5000;
const SPANS = ["10", "30", "120"] as const;
type Span = (typeof SPANS)[number];
const SPAN_LABEL: Record<Span, string> = { "10": "10 s", "30": "30 s", "120": "2 min" };
/** Fächer je Kachel der Waveform; eine Kachel ist so lang wie der Ausschnitt. */
const WAVE_BUCKETS = 1600;

interface Event {
  key: string;
  atMs: number;
  text: string;
  /** Zeile aus der Mitschrift einer anderen, gleichzeitig laufenden Spur (nur lesen). */
  other?: OtherLine;
}

interface OtherLine {
  sourceId: string;
  /** Stelle in der anderen Aufnahme. */
  atMs: number;
  label: string;
  speaker: string;
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

type Item = { kind: "line"; atMs: number; line: TranscriptRow } | { kind: "event"; atMs: number; event: Event };

/** Tonquellen: erst die Dateien desselben Geräts (dieselbe Spur), dann mit Trennlinie die übrigen. */
function sourceOptions(row: SourceRow, avRows: SourceRow[]) {
  const byLabel = (a: SourceRow, b: SourceRow) => a.label.localeCompare(b.label, "de", { numeric: true });
  const same = avRows.filter((r) => r.deviceId === row.deviceId).sort(byLabel);
  const other = avRows.filter((r) => r.deviceId !== row.deviceId).sort(byLabel);
  return [...same, ...other].map((r, i) => ({
    value: r.id,
    label: `${r.label} · ${r.fileName}`,
    groupStart: i === same.length && same.length > 0 ? "Andere Geräte" : undefined,
  }));
}

/** Bei gleicher Stelle: erst „… beginnt“ und Tagebuch, dann Zeilen anderer Spuren, dann die eigenen. */
const itemRank = (it: Item) => (it.kind === "line" ? 2 : it.event.other ? 1 : 0);

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
  useLevel(media, row.level);
  const input = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState(position?.sourceId === row.id ? position.atMs : 0);
  const posRef = useRef(pos);
  posRef.current = pos;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const [span, setSpan] = useState<Span>("30");
  const [logScale, setLogScale] = useState(true);
  const [follow, setFollow] = useState(true);
  const [showOthers, setShowOthers] = useState(true);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [speaker, setSpeaker] = useState("");
  /** Stelle beim ersten Tastendruck der neuen Zeile. */
  const [mark, setMark] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const lines = useMemo(() => view.transcript.filter((l) => l.sourceId === row.id), [view.transcript, row.id]);
  const notes = useMemo(() => view.notes.filter((n) => n.sourceId === row.id), [view.notes, row.id]);
  const speakers = useMemo(
    () => [...new Set(view.transcript.map((l) => l.speaker).filter(Boolean))].sort(),
    [view.transcript],
  );
  const allEvents = useMemo(() => eventsIn(view, row), [view, row]);
  const events = useMemo(() => (showOthers ? allEvents : allEvents.filter((e) => !e.other)), [allEvents, showOthers]);
  const othersCount = useMemo(() => allEvents.filter((e) => e.other).length, [allEvents]);
  const items = useMemo<Item[]>(
    () =>
      [
        ...lines.map((l) => ({ kind: "line" as const, atMs: l.atMs, line: l })),
        ...events.map((e) => ({ kind: "event" as const, atMs: e.atMs, event: e })),
      ].sort((a, b) => a.atMs - b.atMs || itemRank(a) - itemRank(b)),
    [lines, events],
  );
  const nextAt = useMemo(() => {
    const m = new Map<string, number | null>();
    lines.forEach((l, i) => m.set(l.id, lines[i + 1]?.atMs ?? null));
    return m;
  }, [lines]);
  const current = lastAtOrBefore(lines, pos)?.id;

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
  // Sprung von außen (Suche, während Mitschreiben offen ist) an eine andere Stelle derselben Aufnahme.
  useEffect(() => {
    if (position?.sourceId === row.id && Math.abs(position.atMs - posRef.current) > 1000) seekTo(position.atMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);
  useEffect(() => {
    if (media.current) media.current.playbackRate = Number(speed);
  }, [speed]);
  useEffect(() => input.current?.focus(), []);

  // Liste läuft mit: die aktuelle Zeile bleibt sichtbar, solange niemand in der Liste schreibt.
  useEffect(() => {
    if (!follow || !playing || !current || !list.current) return;
    if (list.current.contains(document.activeElement)) return;
    list.current.querySelector(`[data-line="${CSS.escape(current)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, follow, playing]);

  const seekTo = useCallback((ms: number) => {
    const el = media.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms) / 1000;
    setPos(Math.round(el.currentTime * 1000));
  }, []);
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

  // Tastenkürzel gelten im ganzen Dialog, egal wo der Fokus gerade ist (auch nach einem Klick auf
  // Video, Waveform oder eine freie Fläche). Deshalb am Fenster statt am Eingabefeld.
  const shortcut = useRef<(e: globalThis.KeyboardEvent) => void>(() => {});
  shortcut.current = (e) => {
    const target = e.target instanceof Element ? e.target : null;
    switch (transcriberKey(e, target, input.current)) {
      case "toggle":
        e.preventDefault();
        toggle();
        break;
      case "back":
        e.preventDefault();
        seekTo(posRef.current - JUMP_MS);
        break;
      case "forward":
        e.preventDefault();
        seekTo(posRef.current + JUMP_MS);
        break;
      case "slower":
      case "faster":
        e.preventDefault();
        nextSpeed(e.shiftKey ? 1 : -1);
        break;
      case "prevLine":
      case "nextLine": {
        e.preventDefault();
        // Reihenfolge: alle Zeilen der Liste, dann die neue Zeile unten.
        const fields = [
          ...(list.current?.querySelectorAll<HTMLTextAreaElement>(
            '[data-line] textarea[aria-label="Text der Zeile"]',
          ) ?? []),
          ...(input.current ? [input.current] : []),
        ];
        const i = fields.findIndex((f) => f === document.activeElement);
        const next =
          i < 0 ? fields.at(-1) : fields[Math.max(0, Math.min(fields.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)))];
        next?.focus();
        next?.scrollIntoView({ block: "nearest" });
        break;
      }
      case "type":
        // Tippen ohne Fokus landet in der neuen Zeile; der Buchstabe geht mit.
        input.current?.focus();
        break;
    }
  };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => shortcut.current(e);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const scrollToLine = (id: string) =>
    requestAnimationFrame(() =>
      list.current?.querySelector(`[data-line="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }),
    );

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
    scrollToLine(res.lineId);
  };

  // Stabile Handlungen für die Zeilen, damit sie beim Mitlaufen nicht neu zeichnen.
  const latest = useRef({ guard, onView, row, nextAt });
  latest.current = { guard, onView, row, nextAt };
  const lineActions = useMemo<LineActions>(() => {
    const patch = (id: string, p: Partial<Pick<TranscriptRow, "atMs" | "speaker" | "text">>) =>
      void latest.current.guard(() => api.updateTranscriptLine(id, p)).then((v) => v && latest.current.onView(v));
    return {
      seek: (ms) => seekTo(ms),
      retime: (id) => patch(id, { atMs: posRef.current }),
      patch,
      remove: (id) =>
        void latest.current.guard(() => api.deleteTranscriptLine(id)).then((v) => v && latest.current.onView(v)),
      split: async (line, cursor) => {
        const { guard: g, onView: ov, row: r, nextAt: na } = latest.current;
        const s = splitLine(line, cursor, {
          posMs: posRef.current,
          nextAtMs: na.get(line.id) ?? null,
          durationMs: r.durationMs,
        });
        if (!s) return;
        const v = await g(() => api.updateTranscriptLine(line.id, { text: s.first }));
        if (!v) return;
        const res = await g(() =>
          api.addTranscriptLine(r.id, { atMs: s.secondAtMs, speaker: line.speaker, text: s.second }),
        );
        ov(res ? res.view : v);
        if (res)
          requestAnimationFrame(() => {
            const el = list.current?.querySelector<HTMLTextAreaElement>(
              `[data-line="${CSS.escape(res.lineId)}"] textarea[aria-label="Text der Zeile"]`,
            );
            el?.focus();
            el?.setSelectionRange(0, 0);
          });
      },
    };
  }, [seekTo]);

  const apply = (fn: () => Promise<SessionView>) => void guard(fn).then((v) => v && onView(v));

  // Waveform-Ausschnitt um die Stelle.
  const spanMs = Number(span) * 1000;
  const win = waveWindow(pos, spanMs, row.durationMs);
  const peaks = usePeakTiles(row.id, win.fromMs, win.toMs, spanMs, WAVE_BUCKETS, row.durationMs);
  const markers = useMemo<WaveMarker[]>(
    () => [
      ...lines.map((l) => ({ atMs: l.atMs, tone: "accent" as const })),
      ...events.map((e) => ({ atMs: e.atMs, tone: "muted" as const })),
      ...notes
        .filter((n) => n.fromMs !== null && n.toMs === null)
        .map((n) => ({ atMs: n.fromMs!, tone: "warn" as const })),
    ],
    [lines, events, notes],
  );
  const bands = useMemo(() => noteBands(notes), [notes]);
  const openNotesHere = notes.filter(
    (n) => !n.done && n.fromMs !== null && n.fromMs <= pos && (n.toMs ?? n.fromMs + 5000) >= pos,
  );

  const at = (ms: number) => <At ms={ms} startMs={row.startMs} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <Glyph kind={row.kind} />
        <Dialog.Title className="text-base font-semibold">Mitschreiben</Dialog.Title>
        <Picker
          label="Tonquelle"
          placeholder="Tonquelle wählen"
          value={row.id}
          onChange={onSource}
          options={sourceOptions(row, avRows)}
          className="w-72"
        />
        <span className="text-[0.85rem] text-muted">
          {lines.length} {lines.length === 1 ? "Zeile" : "Zeilen"}
        </span>
        <span className="flex-1" />
        <Button size="sm" onClick={onClose}>
          Fertig
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,34%)]">
        <section className="flex min-h-0 flex-col border-r border-line">
          {!failed && (
            <div className="border-b border-line px-4 pt-2.5 pb-2" data-testid="transcriber-wave">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[0.85rem]">
                <span className="font-medium">Waveform</span>
                <Choice
                  label="Ausschnitt"
                  value={span}
                  onChange={setSpan}
                  options={SPANS.map((s) => ({ value: s, label: SPAN_LABEL[s] }))}
                />
                <label
                  className="inline-flex cursor-pointer items-center gap-1.5 text-[0.85rem]"
                  title="Leise Stellen deutlicher zeigen (dB-Skala)"
                >
                  <Toggle checked={logScale} onChange={setLogScale} label="logarithmisch" />
                  logarithmisch
                </label>
                <span className="flex-1" />
                {openNotesHere.length > 0 && (
                  <span className="truncate text-warn" title={openNotesHere.map((n) => n.text).join("\n")}>
                    Notiz: {openNotesHere[0]!.text}
                  </span>
                )}
              </div>
              <Waveform
                peaks={peaks}
                fromMs={win.fromMs}
                toMs={win.toMs}
                scale={logScale ? "log" : "linear"}
                height={92}
                cursorMs={pos}
                markers={markers}
                bands={bands}
                ticks
                onSeek={seekTo}
                label={`Waveform ${positionText(win.fromMs)} bis ${positionText(win.toMs)}`}
              />
            </div>
          )}
          <ol
            ref={list}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
            aria-label="Mitschrift"
            data-testid="lines"
          >
            {items.length === 0 && (
              <li className="py-6 text-center text-[0.9rem] text-muted">
                Noch nichts mitgeschrieben. Starte die Wiedergabe mit Esc und tippe unten mit. Enter legt die Zeile an.
              </li>
            )}
            {items.map((it) =>
              it.kind === "event" && it.event.other ? (
                <OtherLineItem
                  key={it.event.key}
                  atMs={it.atMs}
                  line={it.event.other}
                  startMs={row.startMs}
                  onSeek={seekTo}
                  onOpen={(o) => {
                    seek(o.sourceId, o.atMs);
                    onSource(o.sourceId);
                  }}
                />
              ) : it.kind === "event" ? (
                <li
                  key={it.event.key}
                  className="my-1 flex items-baseline gap-3 rounded-md bg-panel-2 px-2 py-1 text-[0.85rem] text-ink-2"
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
                  startMs={row.startMs}
                  actions={lineActions}
                />
              ),
            )}
          </ol>
          <form
            className="flex items-start gap-2 border-t border-line bg-panel-2 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <span
              className="w-24 flex-none pt-1.5 font-mono text-[0.82rem] text-muted"
              title="Zeitmarke der neuen Zeile"
            >
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
            <textarea
              ref={input}
              rows={1}
              className="max-h-[30vh] min-w-0 flex-1 resize-none [field-sizing:content]"
              aria-label="Neue Zeile"
              placeholder="Mittippen, Enter für die nächste Zeile. „B1: …“ wechselt den Sprecher."
              value={draft}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void commit();
                }
              }}
              onChange={(e) => {
                let v = oneParagraph(e.target.value);
                // „B1: “ am Anfang wechselt sofort den Sprecher.
                const lead = leadingSpeaker(v);
                if (lead) {
                  setSpeaker(lead.speaker);
                  v = lead.rest;
                  if (mark === null) setMark(pos);
                } else {
                  if (mark === null && v) setMark(pos);
                  if (!v) setMark(null);
                }
                setDraft(v);
              }}
            />
            <Button variant="primary" size="sm" type="submit" disabled={!draft.trim()} className="mt-0.5">
              Zeile anlegen
            </Button>
          </form>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          {failed ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[0.85rem] text-warn">
              Diese Datei lässt sich hier nicht abspielen (Format oder Codec).
            </p>
          ) : row.kind === "video" ? (
            <video
              ref={media}
              src={mediaUrl(row.id)}
              {...LEVEL_MEDIA_PROPS}
              preload="auto"
              className="block max-h-[38vh] w-full rounded-lg bg-black"
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
              {...LEVEL_MEDIA_PROPS}
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
            <Scrubber row={row} pos={pos} lines={lines} events={events} bands={bands} window={win} onSeek={seekTo} />
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
            <div className="mt-2">
              <label
                className="inline-flex cursor-pointer items-center gap-1.5 text-[0.85rem]"
                title="Beim Abspielen die aktuelle Zeile im Blick behalten"
              >
                <Toggle checked={follow} onChange={setFollow} label="Liste läuft mit" />
                Liste läuft mit
              </label>
            </div>
            <div className="mt-1.5">
              <label
                className="inline-flex cursor-pointer items-center gap-1.5 text-[0.85rem]"
                title="Zeilen, die in gleichzeitig laufenden Aufnahmen schon mitgeschrieben sind (nur lesen)"
              >
                <Toggle checked={showOthers} onChange={setShowOthers} label="Andere Spuren zeigen" />
                Andere Spuren zeigen
                {othersCount > 0 && <span className="text-muted">({othersCount})</span>}
              </label>
            </div>
          </div>
          <NotesPanel row={row} notes={notes} pos={pos} apply={apply} onSeek={seekTo} />
          <dl className="grid max-w-[75ch] grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-[0.85rem]">
            <dt className="font-mono font-medium">Esc</dt>
            <dd>Abspielen / anhalten (springt beim Fortsetzen 1 s zurück)</dd>
            <dt className="font-mono font-medium">F8 / F9</dt>
            <dd>5 s zurück / vor</dd>
            <dt className="font-mono font-medium">F7</dt>
            <dd>langsamer (mit Umschalt schneller)</dd>
            <dt className="font-mono font-medium">Alt+↑ / ↓</dt>
            <dd>Zur Zeile davor / danach (unten die neue Zeile)</dd>
            <dt className="font-mono font-medium">Enter</dt>
            <dd>Zeile anlegen. Die Zeitmarke ist die Stelle, an der du angefangen hast zu tippen.</dd>
            <dt className="font-mono font-medium">Strg/⌘+Enter</dt>
            <dd>
              In einer Zeile: an der Schreibmarke teilen. Der zweite Teil bekommt die aktuelle Stelle, wenn sie
              dazwischen liegt.
            </dd>
            <dt className="font-mono font-medium">B1: …</dt>
            <dd>
              Sprecher wechseln: sobald nach dem Doppelpunkt ein Leerzeichen folgt, wandert das Kürzel ins Feld davor
              (auch in bestehenden Zeilen)
            </dd>
          </dl>
          <p className="-mt-1 max-w-[75ch] text-[0.85rem] text-muted">
            Die Tasten gelten überall im Dialog. Tippst du, während nichts ausgewählt ist, geht es in der neuen Zeile
            weiter.
          </p>
          <p className="max-w-[75ch] text-[0.85rem] text-muted">
            Jede Zeile speichert die Stelle in {row.label}. Die Uhrzeit folgt dem Abgleich, auch wenn du ihn später
            änderst. ▪ Zeilen zeigen, was gleichzeitig in anderen Quellen passiert. Grau hinterlegte Zeilen mit
            Kurzzeichen stammen aus der Mitschrift einer anderen Spur, die zur selben Zeit lief: Was dort schon steht,
            musst du hier nicht noch einmal abtippen. Notizen sind Arbeitsstand und gehen nicht ins Zeitgerüst.
          </p>
          {row.kind === "video" && (
            <p className="text-[0.85rem] text-muted">{KIND_LABEL.video}: Ton und Bild aus der Datei.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Zeile aus einer anderen Spur: nur lesen; Klick auf die Zeit spult hier, auf das Kurzzeichen öffnet dort. */
function OtherLineItem({
  atMs,
  line,
  startMs,
  onSeek,
  onOpen,
}: {
  atMs: number;
  line: OtherLine;
  startMs: number | null;
  onSeek: (ms: number) => void;
  onOpen: (line: OtherLine) => void;
}) {
  return (
    <li
      className="my-0.5 flex items-start gap-3 rounded-md bg-panel-2 px-2 py-0.5 text-ink-2"
      data-testid="other-line"
      title={`Aus der Mitschrift von ${line.label}, nur lesen`}
    >
      <button
        className="w-36 flex-none cursor-pointer pt-1 text-left font-mono text-[0.85rem] hover:text-accent"
        onClick={() => onSeek(atMs)}
        title="Hierhin springen"
      >
        <At ms={atMs} startMs={startMs} />
      </button>
      <button
        className="w-14 flex-none cursor-pointer truncate pt-1 text-left font-mono text-[0.85rem] font-medium hover:text-accent"
        onClick={() => onOpen(line)}
        title={`In ${line.label} mitschreiben (an dieser Stelle)`}
      >
        {line.label}
      </button>
      <span className="min-w-0 flex-1 py-1 text-[0.9rem] break-words">
        {line.speaker && <span className="mr-1.5 font-mono font-medium">{line.speaker}:</span>}
        {line.text}
      </span>
    </li>
  );
}

function At({ ms, startMs }: { ms: number; startMs: number | null }) {
  return (
    <>
      {positionText(ms)}
      {startMs !== null && <span className="text-muted"> · {clock(startMs + ms)}</span>}
    </>
  );
}

/** Letzte Zeile an oder vor der Stelle (Zeilen sind nach Stelle sortiert). */
function lastAtOrBefore(lines: TranscriptRow[], pos: number): TranscriptRow | undefined {
  let lo = 0;
  let hi = lines.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (lines[m]!.atMs <= pos) {
      hit = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return hit >= 0 ? lines[hit] : undefined;
}

function noteBands(notes: SourceNoteRow[]): WaveBand[] {
  return notes
    .filter((n) => n.fromMs !== null && n.toMs !== null)
    .map((n) => ({ fromMs: n.fromMs!, toMs: n.toMs!, tone: n.done ? ("good" as const) : ("warn" as const) }));
}

interface LineActions {
  seek: (ms: number) => void;
  retime: (id: string) => void;
  patch: (id: string, p: { speaker?: string; text?: string }) => void;
  remove: (id: string) => void;
  split: (line: TranscriptRow, cursor: number) => void | Promise<void>;
}

const Line = memo(function Line({
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
  const [speaker, setSpeaker] = useState(line.speaker);
  const [text, setText] = useState(line.text);
  useEffect(() => setSpeaker(line.speaker), [line.speaker]);
  useEffect(() => setText(line.text), [line.text]);
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

/**
 * Schmale Leiste über die ganze Aufnahme: Zeilen als Striche, Ereignisse als Punkte, Notizen als
 * Bänder, der Ausschnitt der Waveform als Rahmen. Klick spult.
 */
function Scrubber({
  row,
  pos,
  lines,
  events,
  bands,
  window: win,
  onSeek,
}: {
  row: SourceRow;
  pos: number;
  lines: TranscriptRow[];
  events: Event[];
  bands: WaveBand[];
  window: { fromMs: number; toMs: number };
  onSeek: (ms: number) => void;
}) {
  const dur = row.durationMs ?? 0;
  if (!dur) return null;
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / dur) * 100))}%`;
  const width = (a: number, b: number) => `${Math.max(0.3, Math.min(100, ((b - a) / dur) * 100))}%`;
  return (
    <div
      className="relative mt-2 h-6 cursor-pointer overflow-hidden rounded bg-sunken"
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
      data-testid="scrubber"
    >
      {bands.map((b, i) => (
        <span
          key={i}
          className={cx("absolute inset-y-0", b.tone === "good" ? "bg-good/15" : "bg-warn/25")}
          style={{ left: pct(b.fromMs), width: width(b.fromMs, b.toMs) }}
        />
      ))}
      <span
        className="absolute inset-y-0 border-x border-ink-2/40 bg-ink/5"
        style={{ left: pct(win.fromMs), width: width(win.fromMs, win.toMs) }}
      />
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
  const byId = new Map(view.rows.map((r) => [r.id, r]));
  for (const l of view.transcript) {
    if (l.sourceId === row.id || l.clockMs === null || !inside(l.clockMs)) continue;
    const r = byId.get(l.sourceId);
    if (!r) continue;
    out.push({
      key: `t:${l.id}`,
      atMs: l.clockMs - start,
      text: `${r.label}: ${l.speaker ? `${l.speaker}: ` : ""}${l.text}`,
      other: { sourceId: r.id, atMs: l.atMs, label: r.label, speaker: l.speaker, text: l.text },
    });
  }
  for (const d of view.diary) {
    if (!d.window || !inside(d.window.toMs)) continue;
    const short = d.shortText || d.fullText;
    out.push({
      key: `d:${d.id}`,
      atMs: d.window.toMs - start,
      text: `Tagebuch ${d.regions[0]?.pageLabel ?? ""}, Eintrag ${d.number}${d.notedAt ? ` (notiert ${d.notedAt})` : ""}${short ? `: ${short}` : ""}`,
    });
  }
  return out;
}
