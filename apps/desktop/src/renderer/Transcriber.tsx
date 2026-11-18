/**
 * Mitschreiben: eine Ton- oder Videoquelle abhören und von Hand mittippen.
 * Enter legt eine Zeile an; ihre Zeitmarke ist die Stelle, an der du angefangen hast zu tippen.
 * Gespeichert wird die Stelle in der Aufnahme, die Uhrzeit ergibt sich aus dem Abgleich.
 *
 * Für lange Mitschriften: Die Liste zeichnet Zeilen nur neu, wenn sie sich ändern (nicht bei jedem
 * Bild der Wiedergabe), Textfelder wachsen mit, und die Liste läuft der Wiedergabe nach.
 */
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { mediaUrl, type SessionView, type SourceRow, type TranscriptRow } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { clock, KIND_LABEL } from "./format.ts";
import { NotesPanel } from "./Notes.tsx";
import { positionText, usePlayback } from "./playback.tsx";
import { leadingSpeaker, oneParagraph, splitLine, transcriberKey, waveWindow } from "./transcribe.ts";
import { Button, Choice, ErrorBanner, Glyph, Picker, Toggle } from "./ui.tsx";
import { usePeakTiles, Waveform, type WaveMarker } from "./Waveform.tsx";
import { LEVEL_MEDIA_PROPS, useLevel } from "./level.ts";
import { useLatest } from "./hooks.ts";
import { type Item, eventsIn, itemRank, lastAtOrBefore, noteBands, sourceOptions } from "./transcriber/items.ts";
import { At, Line, type LineActions } from "./transcriber/Line.tsx";
import { OtherLineItem } from "./transcriber/OtherLineItem.tsx";
import { createSerialQueue, restoreDraft, takeDraft } from "./transcriber/draft.ts";
import { Scrubber } from "./transcriber/Scrubber.tsx";
import { isEnter } from "./keys.js";

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
  // Eine angefangene Zeile wird angelegt, bevor der Dialog schließt oder die Tonquelle wechselt.
  // Scheitert das Anlegen, bleibt alles offen und der Text im Feld.
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  const close = () => void (flushRef.current?.() ?? Promise.resolve(true)).then((ok) => ok && onClose());
  const switchSource = (id: string) =>
    void (flushRef.current?.() ?? Promise.resolve(true)).then((ok) => ok && onSource(id));
  return (
    <Dialog.Root open={!!row} onOpenChange={(o) => !o && close()}>
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
              onSource={switchSource}
              onClose={close}
              flushRef={flushRef}
              guard={guard}
              onView={onView}
            />
          )}
          <ErrorBanner dialog floating />
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
  flushRef,
  guard,
  onView,
}: {
  view: SessionView;
  row: SourceRow;
  avRows: SourceRow[];
  onSource: (id: string) => void;
  onClose: () => void;
  /** Legt eine angefangene Zeile an; true, wenn danach nichts mehr im Feld steht. */
  flushRef: { current: (() => Promise<boolean>) | null };
  guard: Guard;
  onView: (v: SessionView) => void;
}) {
  const { position, seek } = usePlayback();
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useLevel(media, row.level);
  const input = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState(position?.sourceId === row.id ? position.atMs : 0);
  // Stelle auch zwischen zwei Renderdurchläufen (Tastenkürzel, „Zeit hierher“); wird mit setPos zusammen gesetzt.
  const posRef = useRef(pos);
  const updatePos = (ms: number) => {
    posRef.current = ms;
    setPos(ms);
  };
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const [span, setSpan] = useState<Span>("30");
  const [logScale, setLogScale] = useState(true);
  const [follow, setFollow] = useState(true);
  const [showOthers, setShowOthers] = useState(true);
  const [failed, setFailed] = useState(false);
  const [draft, setDraftState] = useState("");
  const [speaker, setSpeaker] = useState("");
  /** Stelle beim ersten Tastendruck der neuen Zeile. */
  const [mark, setMarkState] = useState<number | null>(null);
  // Feld und Marke auch synchron lesbar: Ein zweites Enter oder Weitertippen kommt vor dem nächsten Rendern an.
  const draftRef = useRef("");
  const markRef = useRef<number | null>(null);
  const speakerRef = useRef("");
  const setDraft = (v: string) => {
    draftRef.current = v;
    setDraftState(v);
  };
  const setMark = (v: number | null) => {
    markRef.current = v;
    setMarkState(v);
  };
  const changeSpeaker = (v: string) => {
    speakerRef.current = v;
    setSpeaker(v);
  };
  const queue = useRef(createSerialQueue());
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

  const handBack = useEffectEvent((el: HTMLMediaElement) => seek(row.id, Math.round(el.currentTime * 1000)));
  // Stelle flüssig nachführen.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (media.current) updatePos(Math.round(media.current.currentTime * 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const el = media.current;
    return () => {
      cancelAnimationFrame(raf);
      // Stelle an die Detailleiste zurückgeben.
      if (el) handBack(el);
    };
  }, [row.id]);
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
    posRef.current = Math.round(el.currentTime * 1000);
    setPos(posRef.current);
  }, []);
  // Sprung von außen (Suche, während Mitschreiben offen ist) an eine andere Stelle derselben Aufnahme.
  useEffect(() => {
    if (position?.sourceId === row.id && Math.abs(position.atMs - posRef.current) > 1000) seekTo(position.atMs);
  }, [position, row.id, seekTo]);
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
  const shortcut = useEffectEvent((e: globalThis.KeyboardEvent) => {
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
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => shortcut(e);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const scrollToLine = (id: string) =>
    requestAnimationFrame(() =>
      list.current?.querySelector(`[data-line="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }),
    );

  const latest = useLatest({ guard, onView, row, nextAt });

  /**
   * Enter: Text und Marke werden sofort aus dem Feld genommen, damit man ohne Wartezeit weitertippen kann und ein
   * zweites Enter nichts doppelt anlegt. Die Zeilen gehen nacheinander zum Hauptprozess. Bei einem Fehler kommt der
   * Text zurück ins Feld. Ergebnis: true, wenn die Zeile angelegt wurde (oder es nichts anzulegen gab).
   */
  const commit = (): Promise<boolean> => {
    const line = takeDraft(draftRef.current, speakerRef.current, markRef.current, posRef.current);
    if (!line) return Promise.resolve(true);
    changeSpeaker(line.speaker);
    setDraft("");
    setMark(null);
    return queue.current.run(async () => {
      const res = await latest.current.guard(() => api.addTranscriptLine(row.id, line));
      if (!res) {
        const back = restoreDraft({ draft: draftRef.current, mark: markRef.current }, line);
        setDraft(back.draft);
        setMark(back.mark);
        return false;
      }
      latest.current.onView(res.view);
      scrollToLine(res.lineId);
      return true;
    });
  };
  const flush = async () => {
    void commit();
    await queue.current.idle();
    return !draftRef.current.trim();
  };
  const flushNow = useEffectEvent(flush);
  useEffect(() => {
    flushRef.current = () => flushNow();
    return () => {
      flushRef.current = null;
    };
  }, [flushRef]);

  // Stabile Handlungen für die Zeilen, damit sie beim Mitlaufen nicht neu zeichnen.
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
  }, [seekTo, latest]);

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
              onChange={(e) => changeSpeaker(e.target.value)}
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
                if (isEnter(e)) {
                  e.preventDefault();
                  void commit();
                }
              }}
              onChange={(e) => {
                let v = oneParagraph(e.target.value);
                // „B1: “ am Anfang wechselt sofort den Sprecher.
                const lead = leadingSpeaker(v);
                if (lead) {
                  changeSpeaker(lead.speaker);
                  v = lead.rest;
                  if (markRef.current === null) setMark(posRef.current);
                } else {
                  if (markRef.current === null && v) setMark(posRef.current);
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
              Diese Datei lässt sich hier nicht abspielen (Format oder Codec). Wandle sie in MP4 (H.264) bzw. WAV oder
              M4A um; siehe Handbuch, „Formate“.
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
