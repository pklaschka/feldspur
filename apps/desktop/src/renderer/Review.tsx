import { useLayoutEffect, useRef, useState } from "react";
import type { DeviceRow, SessionView, SourceRow } from "../shared/api.ts";
import { clock, hm, KIND_GLYPH, lage, STATUS_TEXT } from "./format.ts";

const MIN = 60_000;
const LABEL_W = 180;
const KIND_ORDER = ["video", "audio", "photo", "diary", "note", "gps", "other"];

/** Sinnvoller Abstand der Zeitmarken bei gegebener Auflösung. */
function tickStep(pxPerMin: number): number {
  for (const m of [1, 2, 5, 10, 15, 30, 60, 120]) if (m * pxPerMin >= 64) return m * MIN;
  return 240 * MIN;
}

export function Review({
  view,
  selected,
  onSelect,
}: {
  view: SessionView;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [zoom, setZoom] = useState<number | null>(null); // px pro Minute; null = einpassen

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const placed = view.rows.filter((r) => r.startMs !== null || r.diaryWindow);
  const unplaced = view.rows.filter((r) => r.startMs === null && !r.diaryWindow);

  if (!placed.length) {
    return (
      <section className="panel narrow">
        <h2>Durchsehen</h2>
        <p className="muted">
          Noch keine Quelle hat eine Uhrzeit. Sammle Aufnahmen ein oder trage bei Tagebuchseiten die Randnotiz ein.
        </p>
        {unplaced.length > 0 && <Tray rows={unplaced} selected={selected} onSelect={onSelect} />}
      </section>
    );
  }

  const starts = placed.map((r) => r.diaryWindow?.fromMs ?? r.startMs!);
  const ends = placed.map((r) => Math.max(r.endMs ?? r.startMs ?? 0, r.diaryWindow?.toMs ?? 0));
  const t0 = Math.floor((Math.min(...starts) - 2 * MIN) / (5 * MIN)) * 5 * MIN;
  const t1 = Math.ceil((Math.max(...ends) + 2 * MIN) / (5 * MIN)) * 5 * MIN;
  const fit = Math.max(0.5, (width - LABEL_W - 24) / ((t1 - t0) / MIN));
  const ppm = zoom ?? fit;
  const x = (t: number) => ((t - t0) / MIN) * ppm;
  const w = (a: number, b: number) => Math.max(2, x(b) - x(a));
  const innerW = x(t1);
  const step = tickStep(ppm);
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);

  const devices = [...view.allDevices].sort(
    (a, b) => Number(b.isReference) - Number(a.isReference) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const loose = placed.filter((r) => !r.deviceId);
  const totalEp = view.episodes?.reduce((s, e) => s + e.endMs - e.startMs, 0) ?? 0;

  return (
    <div className="review">
      <div className="section-head">
        <h2>Zeitachse</h2>
        <span className="muted small">
          {clock(t0).slice(0, 5)} – {clock(t1).slice(0, 5)}
          {view.episodes &&
            ` · ${view.episodes.length} ${view.episodes.length === 1 ? "Episode" : "Episoden"}, ${Math.round(totalEp / MIN)} Min. mit Inhalt`}
        </span>
        <span className="sp" />
        <div className="zoom" role="group" aria-label="Zoom">
          <button className="btn sm" onClick={() => setZoom(Math.max(0.5, ppm / 1.6))} aria-label="Verkleinern">
            −
          </button>
          <button className={`btn sm ${zoom === null ? "on" : ""}`} onClick={() => setZoom(null)}>
            Einpassen
          </button>
          <button className="btn sm" onClick={() => setZoom(Math.min(240, ppm * 1.6))} aria-label="Vergrößern">
            +
          </button>
        </div>
      </div>
      <div className="tl-wrap" ref={wrap}>
        <div className="tl" style={{ width: innerW + LABEL_W }}>
          <div className="tl-row ruler">
            <div className="tl-label" />
            <div className="tl-lane" style={{ width: innerW }}>
              {ticks.map((t) => (
                <span key={t} className="tick" style={{ left: x(t) }}>
                  <span className="mono">{hm(t)}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="tl-grid" style={{ left: LABEL_W, width: innerW }} aria-hidden>
            {ticks.map((t) => (
              <span key={t} style={{ left: x(t) }} />
            ))}
          </div>
          <div className="tl-row episodes">
            <div className="tl-label">
              <b>Episoden</b>
              <span className="muted small">{view.episodes ? "aus Tonspuren" : "nach Abgleich"}</span>
            </div>
            <div className="tl-lane" style={{ width: innerW }}>
              {view.episodes?.map((e) => (
                <span
                  key={e.index}
                  className="ep"
                  style={{ left: x(e.startMs), width: w(e.startMs, e.endMs) }}
                  title={`E${e.index} · ${clock(e.startMs)}–${clock(e.endMs)} · ${e.sourceLabels.join(", ")}`}
                >
                  E{e.index}
                </span>
              ))}
              {view.gaps.map((g) => (
                <span
                  key={g.startMs}
                  className="gap"
                  style={{ left: x(g.startMs), width: w(g.startMs, g.endMs) }}
                  title={`Zwischenzeit ${clock(g.startMs)}–${clock(g.endMs)}${g.itemLabels.length ? ` · ${g.itemLabels.join(", ")}` : ""}${g.loudAtMs.length ? ` · ${g.loudAtMs.length} laute Stellen` : ""}`}
                >
                  {g.loudAtMs.length > 0 && <span className="gap-loud">{g.loudAtMs.length}× laut</span>}
                </span>
              ))}
            </div>
          </div>
          {devices.map((d) => (
            <Track
              key={d.id}
              device={d}
              rows={placed.filter((r) => r.deviceId === d.id)}
              x={x}
              w={w}
              innerW={innerW}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
          {loose.length > 0 && (
            <Track device={null} rows={loose} x={x} w={w} innerW={innerW} selected={selected} onSelect={onSelect} />
          )}
        </div>
      </div>
      <div className="legend small muted">
        <span>
          <i className="lg-idle" /> Stille (≥ 5 Min.)
        </span>
        <span>
          <i className="lg-loud" /> laute Stelle in der Stille
        </span>
        <span>
          <i className="lg-diary" /> Tagebuch: Bezugszeitraum bis Notierzeit
        </span>
        <span>
          <i className="lg-check" /> Lage prüfen
        </span>
      </div>
      {unplaced.length > 0 && <Tray rows={unplaced} selected={selected} onSelect={onSelect} />}
    </div>
  );
}

function Track({
  device,
  rows,
  x,
  w,
  innerW,
  selected,
  onSelect,
}: {
  device: DeviceRow | null;
  rows: SourceRow[];
  x: (t: number) => number;
  w: (a: number, b: number) => number;
  innerW: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const kind = device?.kind ?? "other";
  return (
    <div className={`tl-row track k-${kind}`} data-device={device?.label ?? "Ohne Gerät"}>
      <div className="tl-label">
        <span className="glyph">{KIND_GLYPH[kind]}</span>
        <span className="tl-name">
          <b title={device?.label}>{device?.label ?? "Ohne Gerät"}</b>
          <span className="muted small">
            {device?.isReference
              ? "Referenzuhr"
              : device?.personName || `${rows.length} ${rows.length === 1 ? "Datei" : "Dateien"}`}
          </span>
        </span>
      </div>
      <div className="tl-lane" style={{ width: innerW }}>
        {rows.map((r) => {
          const on = selected === r.id ? "on" : "";
          const st = `st-${r.status}`;
          const title = `${r.label} · ${r.fileName}\n${lage(r.startMs, r.endMs)} · ${STATUS_TEXT[r.status]}`;
          if (r.kind === "diary" && r.diaryWindow) {
            const { fromMs, toMs } = r.diaryWindow;
            return (
              <button
                key={r.id}
                className={`item diary ${on} ${st}`}
                style={{ left: x(fromMs), width: w(fromMs, toMs) }}
                onClick={() => onSelect(r.id)}
                title={`${title}\nbezieht sich auf ${hm(fromMs)}–${hm(toMs)}`}
              >
                <span className="diary-pin" />
                <span className="item-text">{r.label}</span>
              </button>
            );
          }
          if (r.startMs === null) return null;
          if (r.endMs !== null && r.endMs > r.startMs) {
            return (
              <button
                key={r.id}
                className={`item clip ${on} ${st}`}
                style={{ left: x(r.startMs), width: w(r.startMs, r.endMs) }}
                onClick={() => onSelect(r.id)}
                title={title}
              >
                {r.idle.map((i) => (
                  <span
                    key={i.startMs}
                    className="idle"
                    style={{ left: x(i.startMs) - x(r.startMs!), width: w(i.startMs, i.endMs) }}
                  />
                ))}
                {r.loudAtMs.map((t) => (
                  <span key={t} className="loud" style={{ left: x(t) - x(r.startMs!) }} />
                ))}
                <span className="item-text">
                  <b>{r.label}</b> {r.fileName}
                </span>
              </button>
            );
          }
          return (
            <button
              key={r.id}
              className={`item point ${on} ${st}`}
              style={{ left: x(r.startMs) }}
              onClick={() => onSelect(r.id)}
              title={title}
              aria-label={r.label}
            />
          );
        })}
      </div>
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
    <section className="tray">
      <div className="section-head">
        <h3>Ohne Uhrzeit</h3>
        <span className="muted small">
          Diese Quellen liegen noch nicht auf der Achse. Wähle eine aus und trage rechts eine Zeit ein.
        </span>
      </div>
      <div className="tray-items">
        {rows.map((r) => (
          <button
            key={r.id}
            className={`chip k-${r.kind} ${selected === r.id ? "on" : ""}`}
            onClick={() => onSelect(r.id)}
          >
            <span className="glyph">{KIND_GLYPH[r.kind]}</span>
            <b className="mono">{r.label}</b> {r.fileName}
          </button>
        ))}
      </div>
    </section>
  );
}
