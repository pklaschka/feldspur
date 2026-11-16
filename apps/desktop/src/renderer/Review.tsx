import { Slider, VisuallyHidden } from "radix-ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { SessionView, SourceRow, TranscriptRow } from "../shared/api.ts";
import { clock, hm, lage, STATUS_TEXT } from "./format.ts";
import {
  buildItems,
  diaryPreview,
  draw,
  EPISODE_H,
  groupTranscript,
  hitTest,
  lineAt,
  MIN,
  readPalette,
  RULER_H,
  setTrackHeight,
  tOf,
  TRACK_H,
  xOf,
  type Item,
  type Track,
} from "./timeline.ts";
import { usePlayback } from "./playback.tsx";
import type { Reveal } from "./SearchDialog.tsx";
import { Button, cx, Glyph, StepHeader, Toggle } from "./ui.tsx";

const LABEL_W = 180;
const KIND_ORDER = ["video", "audio", "photo", "diary", "note", "gps", "other"];
const MAX_PPM = 240;

export function Review({
  view,
  selected,
  onSelect,
  onNext,
  onEpisodes,
  reveal,
}: {
  view: SessionView;
  selected: string | null;
  onSelect: (id: string) => void;
  onNext: () => void;
  /** Episoden für den Einsatz ein- oder ausschalten (nur auf Wunsch). */
  onEpisodes: (on: boolean) => void;
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
  reveal,
}: {
  view: SessionView;
  placed: SourceRow[];
  unplaced: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNext: () => void;
  onEpisodes: (on: boolean) => void;
  reveal: (Reveal & { n: number }) | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(700);
  const [scrollX, setScrollX] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null); // px pro Minute; null = einpassen
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  const { position, seek } = usePlayback();
  const playRow = position ? placed.find((r) => r.id === position.sourceId) : undefined;
  const playheadMs = position && playRow?.startMs != null ? playRow.startMs + position.atMs : null;

  const starts = placed.map((r) => r.startMs ?? r.diaryWindow!.toMs);
  const ends = placed.map((r) => Math.max(r.endMs ?? r.startMs ?? 0, r.diaryWindow?.toMs ?? 0));
  const t0 = Math.floor((Math.min(...starts) - 2 * MIN) / (5 * MIN)) * 5 * MIN;
  const t1 = Math.ceil((Math.max(...ends) + 2 * MIN) / (5 * MIN)) * 5 * MIN;
  const fit = Math.max(0.2, (width - 2) / ((t1 - t0) / MIN));
  const ppm = zoom ?? fit;
  const innerW = Math.max(width, ((t1 - t0) / MIN) * ppm);

  const tracks: Track[] = useMemo(() => {
    const devices = [...view.allDevices].sort(
      (a, b) =>
        Number(b.isReference) - Number(a.isReference) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
    const list: Track[] = devices.map((d) => ({ device: d, rows: placed.filter((r) => r.deviceId === d.id) }));
    const loose = placed.filter((r) => !r.deviceId);
    if (loose.length) list.push({ device: null, rows: loose });
    return list;
  }, [view, placed]);
  const items = useMemo(
    () => buildItems(tracks, view.episodes, view.gaps, view.diary),
    [tracks, view.episodes, view.gaps, view.diary],
  );
  const transcripts = useMemo(() => groupTranscript(view.transcript), [view.transcript]);
  // Die Spuren teilen sich die freie Höhe (Kopf, Legende und „Ohne Uhrzeit“ abgezogen), statt unten Platz frei
  // zu lassen; zwischen 52 und 88 px, damit wenige Spuren nicht zu Balken aufquellen.
  const free = window.innerHeight - 340 - (unplaced.length ? 56 : 0) - RULER_H - EPISODE_H;
  setTrackHeight(Math.max(52, Math.min(88, Math.floor(free / Math.max(1, tracks.length)))));
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

  useEffect(() => {
    const c = canvas.current;
    if (!c || !scroller.current?.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    });
  }, [width, height, scale, tracks, items, selected, hover, themeTick, playheadMs, transcripts]);

  // Aktueller Ausschnitt, auch zwischen zwei Renderdurchläufen (mehrere Mausrad-Ereignisse pro Bild).
  const live = useRef<{ ppm: number; scrollX: number; pendingScroll?: number }>({ ppm, scrollX });
  live.current = { ppm, scrollX: live.current.pendingScroll ?? scrollX, pendingScroll: live.current.pendingScroll };
  const maxScroll = (p: number) => Math.max(0, ((t1 - t0) / MIN) * p - width);

  /** Zoomen und dabei die Zeit `t` an der Bildschirmstelle `x` festhalten. */
  const zoomTo = (next: number, anchor?: { t: number; x: number }) => {
    const clamped = Math.min(MAX_PPM, Math.max(fit, next));
    const a = anchor ?? defaultAnchor();
    const newScroll = Math.min(maxScroll(clamped), Math.max(0, ((a.t - t0) / MIN) * clamped - a.x));
    setZoom(clamped <= fit * 1.001 ? null : clamped);
    live.current = { ppm: clamped, scrollX: newScroll, pendingScroll: newScroll };
    setScrollX(newScroll);
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
    const target = Math.min(maxScroll(p), Math.max(0, ((t - t0) / MIN) * p - width / 2));
    live.current = { ...live.current, scrollX: target, pendingScroll: target };
    setScrollX(target);
  };

  // Sprung von außen (Suche): einen Bereich einpassen, eine Uhrzeit ins Bild holen, falls sie draußen liegt.
  // Solange die Achse noch nie sichtbar war, stimmt die Breite nicht: dann warten, bis sie gemessen ist.
  const measured = width > 0 && !!scroller.current?.clientWidth;
  const doneReveal = useRef(0);
  useEffect(() => {
    if (!reveal || !measured || doneReveal.current === reveal.n) return;
    doneReveal.current = reveal.n;
    const { fromMs, toMs } = reveal;
    if (toMs !== undefined && toMs > fromMs) {
      const p = Math.min(MAX_PPM, Math.max(fit, (width * 0.8) / ((toMs - fromMs) / MIN)));
      zoomTo(p, { t: (fromMs + toMs) / 2, x: width / 2 });
      return;
    }
    const px = xOf(scale, fromMs);
    if (px < 0 || px > width) centerOn(fromMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.n, measured, width]);

  // Neue Scrollposition anwenden, sobald die Breite zum neuen Zoom passt.
  useLayoutEffect(() => {
    const target = live.current.pendingScroll;
    if (target === undefined || !scroller.current) return;
    scroller.current.scrollLeft = target;
    live.current = { ...live.current, pendingScroll: undefined };
  });

  // Mausrad zoomt auf die Mausposition; waagerecht (Touchpad, Umschalt + Rad) wird verschoben.
  const wheel = useRef<(e: globalThis.WheelEvent) => void>(() => {});
  wheel.current = (e) => {
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width : 1;
    // Touchpad-Spreizen kommt als Strg + Rad mit kleinen Schritten.
    const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
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
  useEffect(() => {
    if (playheadMs === null) {
      lastPlayX.current = null;
      return;
    }
    const px = xOf(scale, playheadMs);
    const before = lastPlayX.current;
    lastPlayX.current = px;
    if (zoom === null || before === null || before < 0 || before > width) return;
    if (px > width - 24 || px < 0) {
      const target = Math.min(maxScroll(ppm), Math.max(0, ((playheadMs - t0) / MIN) * ppm - width * 0.15));
      live.current = { ...live.current, scrollX: target, pendingScroll: target };
      setScrollX(target);
      lastPlayX.current = width * 0.15;
    }
  }, [playheadMs]);

  const local = (e: MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onMove = (e: MouseEvent) => {
    const { x, y } = local(e);
    const it = hitTest(items, scale, x, y);
    setHover(it ? { item: it, x, y } : null);
  };
  const onClick = (e: MouseEvent) => {
    const { x, y } = local(e);
    const it = hitTest(items, scale, x, y);
    if (!it || it.type === "episode" || it.type === "gap") return;
    onSelect(it.row.id);
    // In Audio/Video an die geklickte Stelle spulen.
    if (it.type === "clip" && it.row.startMs !== null) {
      const at = Math.min(Math.max(0, tOf(scale, x) - it.row.startMs), it.row.durationMs ?? 0);
      seek(it.row.id, Math.round(at));
    }
  };

  // Unsichere Lagen der Reihe nach durchgehen.
  const toCheck = useMemo(
    () => placed.filter((r) => r.status === "check").sort((a, b) => rowStart(a) - rowStart(b)),
    [placed],
  );
  const nextCheck = () => {
    if (!toCheck.length) return;
    const cur = placed.find((r) => r.id === selected);
    const after = cur
      ? toCheck.find((r) => rowStart(r) > rowStart(cur) || (rowStart(r) === rowStart(cur) && r.id > cur.id))
      : undefined;
    const next = after ?? toCheck[0]!;
    onSelect(next.id);
    const px = xOf(scale, rowStart(next));
    if (px < 0 || px > width) centerOn(rowStart(next));
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
            {toCheck.length} zu prüfen · Nächste →
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
                {!view.session.episodes ? "aus" : view.episodes ? "aus Tonspuren" : "nach Abgleich"}
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
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}
        >
          <div style={{ width: innerW, height }}>
            <canvas
              ref={canvas}
              data-track-h={TRACK_H}
              className={cx(
                "sticky left-0 block",
                hover?.item && hover.item.type !== "episode" && hover.item.type !== "gap" && "cursor-pointer",
              )}
              style={{ width, height }}
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
              onClick={onClick}
              aria-hidden
            />
          </div>
          {hover && (
            <HoverCard item={hover.item} line={hoverLine} x={hover.x} y={hover.y} width={width} offset={scrollX} />
          )}
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
        <Legend swatch="h-2.5 w-[3px] bg-warn">laute Stelle in der Stille</Legend>
        <Legend swatch="h-2.5 w-4.5 border-r-[3px] border-k-diary bg-linear-to-r from-transparent to-k-diary/40">
          Tagebuch: Bezugszeitraum bis Notierzeit
        </Legend>
        <Legend swatch="h-2.5 w-4.5 rounded-xs border-[1.5px] border-dashed border-warn">
          Lage prüfen (anklicken, rechts bestätigen)
        </Legend>
        <span className="ml-auto">
          Klick in Audio/Video spult dorthin · Mausrad zoomt an der Maus · Umschalt + Mausrad verschiebt
        </span>
      </div>
      {/* Direkt unter Achse und Legende: was noch fehlt, gehört zum Blick auf den Tag, nicht ans Seitenende. */}
      {unplaced.length > 0 && <Tray rows={unplaced} selected={selected} onSelect={onSelect} />}
    </div>
  );
}

const rowStart = (r: SourceRow) => r.startMs ?? r.diaryWindow?.toMs ?? 0;

/** Untertitel einer Spur: Referenz, Person oder Anzahl, dazu was noch ohne Zeit ist. */
function trackSub(t: Track, rows: SourceRow[]): string {
  if (!t.device) return `${t.rows.length} ${t.rows.length === 1 ? "Datei" : "Dateien"}`;
  const all = rows.filter((r) => r.deviceId === t.device!.id && !r.partOf);
  const open = all.filter((r) => r.startMs === null && !r.diaryWindow).length;
  const base = t.device.isReference
    ? "Referenzuhr"
    : t.device.personName || `${all.length} ${all.length === 1 ? "Datei" : "Dateien"}`;
  return open ? `${base} · ${open} ohne Zeit` : base;
}

function ZoomGlyph({ minus = false }: { minus?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14M5 7h4" />
      {!minus && <path d="M7 5v4" />}
    </svg>
  );
}

function Legend({ swatch, children }: { swatch: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cx("inline-block", swatch)} />
      {children}
    </span>
  );
}

function HoverCard({
  item,
  line,
  x,
  y,
  width,
  offset,
}: {
  item: Item;
  /** Zeile der Mitschrift unter dem Zeiger. */
  line: TranscriptRow | null;
  x: number;
  y: number;
  width: number;
  offset: number;
}) {
  let title: string;
  let lines: string[];
  if (item.type === "episode") {
    title = `Episode E${item.ep.index}`;
    lines = [`${clock(item.ep.startMs)} – ${clock(item.ep.endMs)}`, item.ep.sourceLabels.join(", ")];
  } else if (item.type === "gap") {
    title = "Zwischenzeit";
    lines = [`${clock(item.gap.startMs)} – ${clock(item.gap.endMs)}`];
    if (item.gap.itemLabels.length) lines.push(item.gap.itemLabels.join(", "));
    if (item.gap.loudAtMs.length) lines.push(`laut: ${item.gap.loudAtMs.slice(0, 4).map(clock).join(", ")}`);
  } else if (item.type === "diary") {
    const e = item.entry;
    title = `Tagebuch ${item.row.label} · Eintrag ${e.number}`;
    lines = [`notiert ${e.notedAt ?? "?"}, bezieht sich auf ${hm(item.t0)}–${hm(item.t1)}`];
    const text = diaryPreview(e);
    if (text) lines.push(text.length > 120 ? `${text.slice(0, 117)}…` : text);
  } else {
    const r = item.row;
    title = `${r.label} · ${r.fileName}`;
    lines = [lage(r.startMs, r.endMs), [STATUS_TEXT[r.status], ...r.notes].join(" · ")];
    if (r.status === "check") lines.push("Anklicken und rechts prüfen");
    if (line) {
      const t = (line.speaker ? `${line.speaker}: ` : "") + line.text;
      lines.push(`${line.clockMs !== null ? clock(line.clockMs) : ""} „${t.length > 140 ? `${t.slice(0, 137)}…` : t}“`);
    }
  }
  const left = offset + Math.min(Math.max(8, x + 12), width - 240);
  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-60 rounded-md bg-ink px-2.5 py-1.5 text-[0.82rem] text-panel shadow-lg dark:border dark:border-line-2 dark:bg-panel-2 dark:text-ink"
      style={{ left, top: y + 14 }}
    >
      <b className="block font-semibold">{title}</b>
      {lines.map((l) => (
        <div key={l} className="opacity-85">
          {l}
        </div>
      ))}
    </div>
  );
}

function Tray({
  rows,
  selected,
  onSelect,
}: {
  rows: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-bad/6 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-[0.95rem] font-semibold text-bad">Ohne Uhrzeit ({rows.length})</h3>
        <span className="text-[0.85rem] text-muted">
          Diese Quellen liegen noch nicht auf der Achse. Wähle eine aus und trage rechts eine Zeit ein.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <button
            key={r.id}
            data-testid="tray-item"
            className={cx(
              "inline-flex cursor-pointer items-center gap-2 rounded-lg border py-1 pr-2.5 pl-1",
              selected === r.id ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-2",
            )}
            onClick={() => onSelect(r.id)}
          >
            <Glyph kind={r.kind} size="sm" />
            <b className="font-mono">{r.label}</b> {r.fileName}
          </button>
        ))}
      </div>
    </section>
  );
}
