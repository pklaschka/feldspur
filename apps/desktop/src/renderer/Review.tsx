import { Slider, VisuallyHidden } from "radix-ui";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { SessionView, SourceRow } from "../shared/api.ts";
import { clock, hm, lage } from "./format.ts";
import {
  buildItems,
  draw,
  edgeAt,
  EPISODE_H,
  groupTranscript,
  hitTest,
  lineAt,
  loudAt,
  MIN,
  readPalette,
  RULER_H,
  setTrackHeight,
  tOf,
  TRACK_H,
  xOf,
  type CompareGhost,
  type Item,
} from "./timeline.ts";
import { prepareCanvas } from "./canvas.ts";
import { usePlayback } from "./playback.tsx";
import type { Reveal } from "./SearchDialog.tsx";
import { Button, cx, Glyph, StepHeader, Toggle } from "./ui.tsx";
import { axisRange, fitPpm, MAX_PPM, revealPpm, scrollFor, wheelFactor, zoomAround } from "./review/viewport.ts";
import { buildTracks, rowStart, trackHeightFor, trackSub } from "./review/tracks.ts";
import { HoverCard, Legend, Tray, ZoomGlyph } from "./review/parts.tsx";
import { useEnvelopes } from "./review/envelopes.ts";
import { CheckList } from "./review/CheckList.tsx";
import { ConflictMark, startText } from "./inspector/ConflictPanel.tsx";
import { asPlaces, checkQueue } from "./inspector/status.ts";
import { signed } from "../shared/conflict-text.ts";

const LABEL_W = 180;

export function Review({
  view,
  selected,
  onSelect,
  onNext,
  onEpisodes,
  onEpisodeEdit,
  reveal,
}: {
  view: SessionView;
  selected: string | null;
  onSelect: (id: string) => void;
  onNext: () => void;
  /** Episoden für den Einsatz ein- oder ausschalten (nur auf Wunsch). */
  onEpisodes: (on: boolean) => void;
  onEpisodeEdit: (e: EpisodeEdit) => void;
  /** Sprungziel von außen (Suche): Uhrzeit oder Bereich ins Bild holen. */
  reveal: (Reveal & { n: number }) | null;
}) {
  // Weitere Bilder einer Seite stehen nicht einzeln auf der Zeitleiste; sie gehören zur Hauptquelle.
  const rows = view.rows.filter((r) => !r.partOf);
  const placed = rows.filter((r) => r.startMs !== null || r.diaryWindow);
  const unplaced = rows.filter((r) => r.startMs === null && !r.diaryWindow);

  if (!placed.length) {
    return (
      <div>
        <StepHeader
          title="Durchsehen"
          summary="Noch keine Quelle hat eine Uhrzeit. Sammle Aufnahmen ein oder trage bei Tagebuchseiten die Randnotiz ein."
        />
        {unplaced.length > 0 && <Tray rows={unplaced} selected={selected} onSelect={onSelect} />}
      </div>
    );
  }
  return (
    <Timeline
      view={view}
      placed={placed}
      unplaced={unplaced}
      selected={selected}
      onSelect={onSelect}
      onNext={onNext}
      onEpisodes={onEpisodes}
      onEpisodeEdit={onEpisodeEdit}
      reveal={reveal}
    />
  );
}

function Timeline({
  view,
  placed,
  unplaced,
  selected,
  onSelect,
  onNext,
  onEpisodes,
  onEpisodeEdit,
  reveal,
}: {
  view: SessionView;
  placed: SourceRow[];
  unplaced: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNext: () => void;
  onEpisodes: (on: boolean) => void;
  onEpisodeEdit: (e: EpisodeEdit) => void;
  reveal: (Reveal & { n: number }) | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(700);
  const [scrollX, setScrollX] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null); // px pro Minute; null = einpassen
  // x/y: auf der Leinwand (Treffer, Mitschrift-Zeile); clientX/clientY: im Fenster (Lage der Karte).
  const [hover, setHover] = useState<{ item: Item; x: number; y: number; clientX: number; clientY: number } | null>(
    null,
  );
  const [themeTick, setThemeTick] = useState(0);
  const envelopes = useEnvelopes(view);
  /** Ziehen einer Episodengrenze: Ausgangslage und aktuelle Lage (Uhrzeit). */
  const [drag, setDrag] = useState<{ edge: "start" | "end"; from: number; t: number } | null>(null);
  const { position, seek } = usePlayback();
  const playRow = position ? placed.find((r) => r.id === position.sourceId) : undefined;
  const playheadMs = position && playRow?.startMs != null ? playRow.startMs + position.atMs : null;

  const { t0, t1 } = axisRange(placed);
  const axis = { t0, t1, width };
  const fit = fitPpm(width, t0, t1);
  const ppm = zoom ?? fit;
  const innerW = Math.max(width, ((t1 - t0) / MIN) * ppm);

  const tracks = useMemo(() => buildTracks(view.allDevices, placed), [view.allDevices, placed]);
  const items = useMemo(
    () => buildItems(tracks, view.episodes, view.gaps, view.diary),
    [tracks, view.episodes, view.gaps, view.diary],
  );
  const transcripts = useMemo(() => groupTranscript(view.transcript), [view.transcript]);
  // Die Spuren teilen sich die freie Höhe (Kopf, Legende und „Ohne Uhrzeit“ abgezogen), statt unten Platz frei
  // zu lassen; zwischen 52 und 88 px, damit wenige Spuren nicht zu Balken aufquellen.
  const free = window.innerHeight - 340 - (unplaced.length ? 56 : 0) - RULER_H - EPISODE_H;
  setTrackHeight(trackHeightFor(free, tracks.length));
  const height = RULER_H + EPISODE_H + tracks.length * TRACK_H;
  const scale = useMemo(() => ({ start: t0 + (scrollX / ppm) * MIN, pxPerMin: ppm }), [t0, scrollX, ppm]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Solange Durchsehen ausgeblendet ist, ist die Breite 0: dann den alten Ausschnitt behalten und beim
    // Wiedereinblenden die Scrollposition erneut setzen (ausgeblendete Elemente verlieren sie).
    const measure = () => {
      if (!el.clientWidth) return;
      live.current = { ...live.current, pendingScroll: live.current.scrollX };
      setWidth(el.clientWidth);
      setScrollX(live.current.scrollX);
      // Ausgeblendet wird nicht gezeichnet; beim Wiedereinblenden einmal neu zeichnen.
      setThemeTick((n) => n + 1);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setThemeTick((n) => n + 1);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Vergleichslage der gewählten Quelle: wo sie laut am weitesten abweichendem Beleg läge.
  const compare = useMemo((): CompareGhost | null => {
    const r = placed.find((x) => x.id === selected);
    if (!r || r.startMs === null || (r.conflict.state !== "open" && r.conflict.state !== "stale")) return null;
    const worst = r.evidence.find((e) => e.compare && e.enabled && e.compare.differenceMs === r.conflict.worstMs);
    const track = tracks.findIndex((t) => t.rows.some((x) => x.id === r.id));
    if (!worst?.compare || track < 0) return null;
    const len = (r.endMs ?? r.startMs) - r.startMs;
    return {
      track,
      from: r.startMs,
      t0: worst.compare.startMs,
      t1: worst.compare.startMs + len,
      point: len <= 0,
      label: signed(worst.compare.differenceMs),
      at: startText(worst.compare),
    };
  }, [placed, selected, tracks]);

  // Vor dem Anzeigen zeichnen (Layout-Effekt), damit nach Scrollen oder Zoomen nie ein alter Ausschnitt aufblitzt.
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !scroller.current?.clientWidth) return;
    const ctx = prepareCanvas(c, width, height);
    if (!ctx) return;
    draw(ctx, readPalette(document.documentElement), {
      scale,
      width,
      height,
      tracks,
      items,
      selected,
      hover: hover?.item ?? null,
      playheadMs,
      transcripts,
      envelopes,
      dragEdge: drag && { t: drag.t },
      compare,
    });
  }, [
    width,
    height,
    scale,
    tracks,
    items,
    selected,
    hover,
    themeTick,
    playheadMs,
    transcripts,
    envelopes,
    drag,
    compare,
  ]);

  // Aktueller Ausschnitt, auch zwischen zwei Renderdurchläufen (mehrere Mausrad-Ereignisse pro Bild).
  const live = useRef<{ ppm: number; scrollX: number; pendingScroll?: number }>({ ppm, scrollX });
  live.current = { ppm, scrollX: live.current.pendingScroll ?? scrollX, pendingScroll: live.current.pendingScroll };

  /** Zoomen und dabei die Zeit `t` an der Bildschirmstelle `x` festhalten. */
  const zoomTo = (next: number, anchor?: { t: number; x: number }) => {
    const z = zoomAround(next, anchor ?? defaultAnchor(), axis);
    setZoom(z.zoom);
    live.current = { ppm: z.ppm, scrollX: z.scrollX, pendingScroll: z.scrollX };
    setScrollX(z.scrollX);
  };
  /** Ohne Mauszeiger wird um die Abspielposition gezoomt, sonst um die Mitte des Ausschnitts. */
  const defaultAnchor = () => {
    const { ppm: p, scrollX: sx } = live.current;
    const sc = { start: t0 + (sx / p) * MIN, pxPerMin: p };
    if (playheadMs !== null) {
      const px = xOf(sc, playheadMs);
      return { t: playheadMs, x: px >= 0 && px <= width ? px : width / 2 };
    }
    return { t: tOf(sc, width / 2), x: width / 2 };
  };
  /** Zeitpunkt in die Mitte holen, ohne den Zoom zu ändern. */
  const centerOn = (t: number) => {
    const { ppm: p } = live.current;
    const target = scrollFor(t, width / 2, p, axis);
    live.current = { ...live.current, scrollX: target, pendingScroll: target };
    setScrollX(target);
  };

  // Sprung von außen (Suche): einen Bereich einpassen, eine Uhrzeit ins Bild holen, falls sie draußen liegt.
  // Solange die Achse noch nie sichtbar war, stimmt die Breite nicht: dann warten, bis sie gemessen ist.
  const measured = width > 0 && !!scroller.current?.clientWidth;
  const doneReveal = useRef(0);
  const applyReveal = useEffectEvent(() => {
    if (!reveal || !measured || doneReveal.current === reveal.n) return;
    doneReveal.current = reveal.n;
    const { fromMs, toMs } = reveal;
    if (toMs !== undefined && toMs > fromMs) {
      zoomTo(revealPpm(fromMs, toMs, axis), { t: (fromMs + toMs) / 2, x: width / 2 });
      return;
    }
    const px = xOf(scale, fromMs);
    if (px < 0 || px > width) centerOn(fromMs);
  });
  const revealN = reveal?.n;
  useEffect(() => applyReveal(), [revealN, measured, width]);

  // Neue Scrollposition anwenden, sobald die Breite zum neuen Zoom passt. Ohne Abhängigkeiten, also nach jedem
  // Rendern: Eine Position steht an, wann immer live.current.pendingScroll gesetzt ist, und das passiert neben
  // mehreren Zustandsänderungen (Zoom, Breite, Wiedereinblenden). setState nur, wenn der Browser begrenzt hat.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bewusst nach jedem Rendern, siehe oben
  useLayoutEffect(() => {
    const target = live.current.pendingScroll;
    if (target === undefined || !scroller.current) return;
    scroller.current.scrollLeft = target;
    live.current = { ...live.current, pendingScroll: undefined };
    // Hat der Browser die Position begrenzt, zählt seine.
    if (Math.abs(scroller.current.scrollLeft - target) > 1) setScrollX(scroller.current.scrollLeft);
  });

  // Mausrad zoomt auf die Mausposition; waagerecht (Touchpad, Umschalt + Rad) wird verschoben.
  const wheel = useRef<(e: globalThis.WheelEvent) => void>(() => {});
  wheel.current = (e) => {
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const factor = wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey, width);
    const r = canvas.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const { ppm: p, scrollX: sx } = live.current;
    zoomTo(p * factor, { t: t0 + ((sx + x) / p) * MIN, x });
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = (e: globalThis.WheelEvent) => wheel.current(e);
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  // Beim Abspielen mitlaufen, solange die Abspielposition vorher zu sehen war.
  const lastPlayX = useRef<number | null>(null);
  const followPlayhead = useEffectEvent(() => {
    if (playheadMs === null) {
      lastPlayX.current = null;
      return;
    }
    const px = xOf(scale, playheadMs);
    const before = lastPlayX.current;
    lastPlayX.current = px;
    if (zoom === null || before === null || before < 0 || before > width) return;
    if (px > width - 24 || px < 0) {
      const target = scrollFor(playheadMs, width * 0.15, ppm, axis);
      live.current = { ...live.current, scrollX: target, pendingScroll: target };
      setScrollX(target);
      lastPlayX.current = width * 0.15;
    }
  });
  useEffect(() => followPlayhead(), [playheadMs]);

  // Mittlere Maustaste (Mausrad drücken) und ziehen verschiebt die Zeitachse.
  const [panning, setPanning] = useState(false);
  const onPanStart = (e: MouseEvent) => {
    if (e.button !== 1 || !scroller.current) return;
    e.preventDefault(); // sonst startet der Browser sein eigenes Auto-Scrollen
    const el = scroller.current;
    const x0 = e.clientX;
    const s0 = el.scrollLeft;
    setPanning(true);
    setHover(null);
    const move = (ev: globalThis.MouseEvent) => {
      el.scrollLeft = s0 - (ev.clientX - x0);
    };
    const up = (ev: globalThis.MouseEvent) => {
      if (ev.button !== 1) return;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setPanning(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const local = (e: MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // Unter dem Zeiger: Grenze einer Episode (ziehen) oder laute Stelle in der Stille (Klick = Mini-Episode).
  const [handle, setHandle] = useState<"edge" | "loud" | null>(null);
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    const hit = edgeAt(items, scale, x, y);
    if (!hit) return;
    e.preventDefault();
    setHover(null);
    setDrag({ edge: hit.edge, from: hit.t, t: hit.t });
    const move = (ev: globalThis.MouseEvent) => {
      const r = canvas.current!.getBoundingClientRect();
      // Auf ganze Sekunden runden: genauer lässt sich eine Grenze ohnehin nicht setzen.
      const t = Math.round(tOf(scaleRef.current, ev.clientX - r.left) / 1000) * 1000;
      setDrag((d) => d && { ...d, t });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDrag((d) => {
        if (d && Math.abs(d.t - d.from) >= 1000)
          queueMicrotask(() => onEpisodeEdit({ kind: "edge", edge: d.edge, fromMs: d.from, toMs: d.t }));
        return null;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onMove = (e: MouseEvent) => {
    if (drag) return;
    const { x, y } = local(e);
    setHandle(edgeAt(items, scale, x, y) ? "edge" : loudAt(items, scale, x, y) !== null ? "loud" : null);
    const it = hitTest(items, scale, x, y);
    setHover(it ? { item: it, x, y, clientX: e.clientX, clientY: e.clientY } : null);
  };
  const onClick = (e: MouseEvent) => {
    const { x, y } = local(e);
    const loud = loudAt(items, scale, x, y);
    if (loud !== null && !edgeAt(items, scale, x, y)) {
      onEpisodeEdit({ kind: "loud", atMs: loud });
      return;
    }
    const it = hitTest(items, scale, x, y);
    if (!it || it.type === "episode" || it.type === "gap") return;
    onSelect(it.row.id);
    // In Audio/Video an die geklickte Stelle spulen.
    if (it.type === "clip" && it.row.startMs !== null) {
      const at = Math.min(Math.max(0, tOf(scale, x) - it.row.startMs), it.row.durationMs ?? 0);
      seek(it.row.id, Math.round(at));
    }
  };

  // Unsichere Lagen in der Reihenfolge der Prüfliste durchgehen (stärkste Widersprüche zuerst).
  const toCheck = useMemo(() => checkQueue(placed), [placed]);
  const show = (r: SourceRow) => {
    const px = xOf(scale, rowStart(r));
    if (px < 0 || px > width) centerOn(rowStart(r));
  };
  const nextCheck = () => {
    if (!toCheck.length) return;
    const i = toCheck.findIndex((r) => r.id === selected);
    const next = toCheck[(i + 1) % toCheck.length]!;
    onSelect(next.id);
    show(next);
  };
  const selectFromList = (id: string) => {
    onSelect(id);
    const r = placed.find((x) => x.id === id);
    if (r) show(r);
  };
  const hoverLine =
    hover?.item.type === "clip" && hover.item.row.startMs !== null
      ? lineAt(transcripts.get(hover.item.row.id), tOf(scale, hover.x) - hover.item.row.startMs)
      : null;

  const totalEp = view.episodes?.reduce((s, e) => s + e.endMs - e.startMs, 0) ?? 0;
  // Schieberegler logarithmisch zwischen „Einpassen“ und 240 px/min.
  const sliderMax = Math.log(MAX_PPM / fit);
  const sliderVal = Math.log(ppm / fit);

  return (
    <div>
      <StepHeader
        title="Durchsehen"
        summary={
          <span>
            <span className="font-mono">
              {hm(t0)} – {hm(t1)}
            </span>
            {view.episodes &&
              ` · ${view.episodes.length} ${view.episodes.length === 1 ? "Episode" : "Episoden"}, ${Math.round(totalEp / MIN)} Min. mit Inhalt`}
          </span>
        }
      >
        {/* Wie in Abgleichen: „Weiter“ wird erst zum Hauptknopf, wenn nichts mehr zu prüfen ist. */}
        <Button variant={toCheck.length || unplaced.length ? "default" : "primary"} onClick={onNext}>
          Weiter: Ausgeben →
        </Button>
      </StepHeader>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Zeitachse</h3>
        {toCheck.length > 0 && (
          <Button
            size="sm"
            className="rounded-full bg-warn-soft text-warn hover:brightness-95"
            onClick={nextCheck}
            title="Springt zur nächsten Quelle mit unsicherer Lage. Rechts lässt sie sich als geprüft markieren."
            data-testid="next-check"
          >
            {asPlaces(toCheck, view.conflictGroups).length} zu prüfen · Nächste →
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" disabled={zoom === null} onClick={() => zoomTo(fit)}>
          Einpassen
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Verkleinern"
          onClick={() => zoomTo(ppm / 1.5)}
          disabled={zoom === null}
        >
          <ZoomGlyph minus />
        </Button>
        <Slider.Root
          className="relative flex h-5 w-40 touch-none items-center select-none"
          min={0}
          max={Math.max(0.01, sliderMax)}
          step={0.01}
          value={[sliderVal]}
          onValueChange={([v]) => zoomTo(fit * Math.exp(v ?? 0))}
          aria-label="Zoom"
        >
          <Slider.Track className="relative h-1 grow rounded-full bg-sunken">
            <Slider.Range className="absolute h-full rounded-full bg-accent/50" />
          </Slider.Track>
          <Slider.Thumb className="block size-4 rounded-full border-2 border-accent bg-panel shadow" />
        </Slider.Root>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Vergrößern"
          onClick={() => zoomTo(ppm * 1.5)}
          disabled={ppm >= MAX_PPM}
        >
          <ZoomGlyph />
        </Button>
      </div>

      <div className="flex overflow-hidden rounded-xl border border-line bg-panel shadow-xs">
        <div className="flex-none border-r border-line" style={{ width: LABEL_W }}>
          <div className="border-b border-line bg-panel-2" style={{ height: RULER_H }} />
          <div
            className="flex items-center gap-2 border-b border-line px-3 leading-tight"
            style={{ height: EPISODE_H }}
          >
            <span className="grid min-w-0 flex-1">
              <b className="font-semibold">Episoden</b>
              <span className="truncate text-[0.85rem] text-muted">
                {!view.session.episodes ? (
                  "aus"
                ) : view.episodeEdits ? (
                  <button
                    className="cursor-pointer text-accent underline-offset-2 hover:underline"
                    title={`Von Hand angepasst (${view.episodeEdits}×). Klick verwirft die Anpassungen; Episoden entstehen dann wieder nur aus den Tonspuren.`}
                    aria-label="Angepasste Episoden zurücksetzen"
                    onClick={() => onEpisodeEdit({ kind: "reset" })}
                  >
                    ↺ zurücksetzen
                  </button>
                ) : view.episodes ? (
                  "aus Tonspuren"
                ) : (
                  "nach Abgleich"
                )}
              </span>
            </span>
            <Toggle checked={view.session.episodes} onChange={onEpisodes} label="Episoden bilden" />
          </div>
          {tracks.map((t) => (
            <div
              key={t.device?.id ?? "loose"}
              data-testid="track"
              data-device={t.device?.label ?? "Ohne Gerät"}
              className="flex items-center gap-2 border-b border-line px-3 last:border-b-0"
              style={{ height: TRACK_H }}
            >
              <Glyph kind={t.device?.kind ?? "other"} />
              <span className="grid min-w-0 leading-tight">
                {/* Lange Gerätenamen brechen um statt abgeschnitten zu werden; die Zusatzzeile weicht dann. */}
                <b className="line-clamp-2 text-[0.92rem] font-medium break-words" title={t.device?.label}>
                  {t.device?.label ?? "Ohne Gerät"}
                </b>
                <span className="truncate text-[0.8rem] text-muted" title={trackSub(t, view.rows)}>
                  {trackSub(t, view.rows)}
                </span>
              </span>
            </div>
          ))}
        </div>
        <div
          ref={scroller}
          className={cx("relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden", panning && "cursor-grabbing")}
          onMouseDown={onPanStart}
          onAuxClick={(e) => e.button === 1 && e.preventDefault()}
          onScroll={(e) => {
            // Steht eine neue Position noch aus (mehrere Mausrad-Schritte zwischen zwei Bildern), meldet das
            // Scroll-Ereignis noch die alte. Übernommen, würde ein Bild lang der alte Ausschnitt zum neuen Zoom
            // gezeichnet: Das war das Springen und Flackern beim Zoomen.
            if (live.current.pendingScroll !== undefined) return;
            setScrollX(e.currentTarget.scrollLeft);
          }}
        >
          <div style={{ width: innerW, height }}>
            <canvas
              ref={canvas}
              data-track-h={TRACK_H}
              className={cx(
                "sticky left-0 block",
                drag || handle === "edge"
                  ? "cursor-ew-resize"
                  : (handle === "loud" ||
                      (hover?.item && hover.item.type !== "episode" && hover.item.type !== "gap")) &&
                      "cursor-pointer",
              )}
              style={{ width, height }}
              onMouseDown={onDown}
              onMouseMove={(e) => !panning && onMove(e)}
              onMouseLeave={() => setHover(null)}
              onClick={onClick}
              aria-hidden
            />
          </div>
          {hover && !drag && <HoverCard item={hover.item} line={hoverLine} x={hover.clientX} y={hover.clientY} />}
        </div>
      </div>

      {/* Für Bildschirmleser und Tastatur: dieselben Elemente als Liste. */}
      <VisuallyHidden.Root asChild>
        <ul aria-label="Elemente der Zeitachse">
          {view.episodes?.map((e) => (
            <li key={`e${e.index}`} data-testid="episode">
              E{e.index} {clock(e.startMs)}–{clock(e.endMs)}
            </li>
          ))}
          {items.map(
            (it) =>
              it.type !== "episode" &&
              it.type !== "gap" && (
                <li key={it.type === "diary" ? it.entry.id : it.row.id}>
                  <button data-testid={`tl-${it.type}`} onClick={() => onSelect(it.row.id)}>
                    {it.row.label} {it.row.fileName}{" "}
                    {it.type === "diary"
                      ? `Eintrag ${it.entry.number} ${hm(it.t0)}–${hm(it.t1)} ${it.entry.shortText}`
                      : lage(it.row.startMs, it.row.endMs)}
                  </button>
                </li>
              ),
          )}
        </ul>
      </VisuallyHidden.Root>

      <div className="mx-0.5 mt-2.5 flex flex-wrap gap-5 text-[0.85rem] text-muted">
        <Legend swatch="hatch h-2.5 w-4.5 rounded-xs border border-line-2">Stille (≥ 5 Min.)</Legend>
        <Legend swatch="h-2.5 w-[3px] bg-warn">laute Stelle in der Stille (Klick: Mini-Episode)</Legend>
        <Legend swatch="h-2.5 w-4.5 border-r-[3px] border-k-diary bg-linear-to-r from-transparent to-k-diary/40">
          Tagebuch: Bezugszeitraum bis Notierzeit
        </Legend>
        <Legend swatch="h-2.5 w-4.5 rounded-xs border-[1.5px] border-dashed border-warn">
          Lage prüfen (anklicken, rechts bestätigen)
        </Legend>
        <Legend
          swatch={
            <span className="inline-flex gap-0.5">
              <ConflictMark severity="clear" />
              <ConflictMark severity="strong" />
            </span>
          }
        >
          Zeitbelege widersprechen sich (gefüllt: stark)
        </Legend>
        <Legend swatch="size-2.5 rotate-45 rounded-[2px] border-[1.5px] border-dashed border-warn">
          Vergleichslage laut anderem Beleg
        </Legend>
        <span className="ml-auto">
          Klick in Audio/Video spult dorthin · Episodengrenzen lassen sich ziehen · Mausrad zoomt an der Maus · Umschalt
          + Mausrad oder Mausrad gedrückt ziehen verschiebt
        </span>
      </div>
      <CheckList view={view} selected={selected} onSelect={selectFromList} />
      {/* Direkt unter Achse und Legende: was noch fehlt, gehört zum Blick auf den Tag, nicht ans Seitenende. */}
      {unplaced.length > 0 && <Tray rows={unplaced} selected={selected} onSelect={onSelect} />}
    </div>
  );
}
export type EpisodeEdit =
  | { kind: "edge"; edge: "start" | "end"; fromMs: number; toMs: number }
  | { kind: "loud"; atMs: number }
  | { kind: "reset" };
