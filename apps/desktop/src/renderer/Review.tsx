import { Slider, VisuallyHidden } from "radix-ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from "react";
import type { SessionView, SourceRow } from "../shared/api.ts";
import { clock, hm, lage, STATUS_TEXT } from "./format.ts";
import {
  buildItems,
  draw,
  EPISODE_H,
  hitTest,
  MIN,
  readPalette,
  RULER_H,
  tOf,
  TRACK_H,
  type Item,
  type Track,
} from "./timeline.ts";
import { usePlayback } from "./playback.tsx";
import { Button, cx, Glyph, StepHeader } from "./ui.tsx";

const LABEL_W = 180;
const KIND_ORDER = ["video", "audio", "photo", "diary", "note", "gps", "other"];
const MAX_PPM = 240;

export function Review({
  view,
  selected,
  onSelect,
  onNext,
}: {
  view: SessionView;
  selected: string | null;
  onSelect: (id: string) => void;
  onNext: () => void;
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
    <Timeline view={view} placed={placed} unplaced={unplaced} selected={selected} onSelect={onSelect} onNext={onNext} />
  );
}

function Timeline({
  view,
  placed,
  unplaced,
  selected,
  onSelect,
  onNext,
}: {
  view: SessionView;
  placed: SourceRow[];
  unplaced: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNext: () => void;
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

  const starts = placed.map((r) => r.startMs ?? r.diaryWindow!.fromMs);
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
  const height = RULER_H + EPISODE_H + tracks.length * TRACK_H;
  const scale = useMemo(() => ({ start: t0 + (scrollX / ppm) * MIN, pxPerMin: ppm }), [t0, scrollX, ppm]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
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
    if (!c) return;
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
    });
  }, [width, height, scale, tracks, items, selected, hover, themeTick, playheadMs]);

  /** Zoomen und dabei die Zeit unter dem Zeiger festhalten. */
  const zoomTo = (next: number, anchorX = width / 2) => {
    const clamped = Math.min(MAX_PPM, Math.max(fit, next));
    const tAnchor = tOf(scale, anchorX);
    const newScroll = ((tAnchor - t0) / MIN) * clamped - anchorX;
    setZoom(clamped <= fit * 1.001 ? null : clamped);
    requestAnimationFrame(() => scroller.current?.scrollTo({ left: Math.max(0, newScroll) }));
  };

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
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    zoomTo(ppm * (e.deltaY < 0 ? 1.25 : 0.8), local(e).x);
  };

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
        <Button variant="primary" onClick={onNext}>
          Weiter: Ausgeben →
        </Button>
      </StepHeader>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Zeitachse</h3>
        <span className="flex-1" />
        <Button size="sm" disabled={zoom === null} onClick={() => setZoom(null)}>
          Einpassen
        </Button>
        <span className="flex items-center gap-2 text-muted" aria-hidden>
          <ZoomGlyph minus />
        </span>
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
        <span className="text-muted" aria-hidden>
          <ZoomGlyph />
        </span>
      </div>

      <div className="flex overflow-hidden rounded-[10px] border border-line bg-panel shadow-xs">
        <div className="flex-none border-r border-line" style={{ width: LABEL_W }}>
          <div className="border-b border-line bg-panel-2" style={{ height: RULER_H }} />
          <div className="grid content-center border-b border-line px-3 leading-tight" style={{ height: EPISODE_H }}>
            <b className="font-semibold">Episoden</b>
            <span className="text-[0.8rem] text-muted">{view.episodes ? "aus Tonspuren" : "nach Abgleich"}</span>
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
                <b className="truncate font-medium" title={t.device?.label}>
                  {t.device?.label ?? "Ohne Gerät"}
                </b>
                <span className="text-[0.8rem] text-muted">{trackSub(t, view.rows)}</span>
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
              className={cx(
                "sticky left-0 block",
                hover?.item && hover.item.type !== "episode" && hover.item.type !== "gap" && "cursor-pointer",
              )}
              style={{ width, height }}
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
              onClick={onClick}
              onWheel={onWheel}
              aria-hidden
            />
          </div>
          {hover && <HoverCard item={hover.item} x={hover.x} y={hover.y} width={width} offset={scrollX} />}
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

      <div className="mx-0.5 mt-2.5 flex flex-wrap gap-5 text-[0.8rem] text-muted">
        <Legend swatch="hatch h-2.5 w-4.5 rounded-xs border border-line-2">Stille (≥ 5 Min.)</Legend>
        <Legend swatch="h-2.5 w-[3px] bg-warn">laute Stelle in der Stille</Legend>
        <Legend swatch="h-2.5 w-4.5 border-r-[3px] border-k-diary bg-linear-to-r from-transparent to-k-diary/40">
          Tagebuch: Bezugszeitraum bis Notierzeit
        </Legend>
        <Legend swatch="h-2.5 w-4.5 rounded-xs border-[1.5px] border-dashed border-warn">Lage prüfen</Legend>
        <span className="ml-auto">Klick in Audio/Video spult dorthin · Strg + Mausrad zoomt</span>
      </div>
      {unplaced.length > 0 && <Tray rows={unplaced} selected={selected} onSelect={onSelect} />}
    </div>
  );
}

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

function HoverCard({ item, x, y, width, offset }: { item: Item; x: number; y: number; width: number; offset: number }) {
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
    if (e.shortText) lines.push(e.shortText.length > 120 ? `${e.shortText.slice(0, 117)}…` : e.shortText);
  } else {
    const r = item.row;
    title = `${r.label} · ${r.fileName}`;
    lines = [lage(r.startMs, r.endMs), [STATUS_TEXT[r.status], ...r.notes].join(" · ")];
  }
  const left = offset + Math.min(Math.max(8, x + 12), width - 240);
  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-60 rounded-md bg-ink px-2.5 py-1.5 text-[0.78rem] text-panel shadow-lg dark:border dark:border-line-2 dark:bg-panel-2 dark:text-ink"
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
    <section className="mt-5">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="text-[0.9rem] font-semibold">Ohne Uhrzeit</h3>
        <span className="text-[0.8rem] text-muted">
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
