import { useEffect, useState } from "react";
import type { DeviceRow, ProposalRow, SessionView } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { KIND_GLYPH, offsetText, parseOffset } from "./format.ts";

const api = window.feldspur;

const mmss = (ms: number) =>
  offsetText(ms)
    .replace(/^[+−-]\s*/, "")
    .replace(/\.\d+/, "");

const BASIS_TEXT = { reference: "Referenz", manual: "von Hand", anchor: "über Tonspur", unknown: "" } as const;

export function Sync({
  view,
  guard,
  onView,
  onReference,
  onOffset,
  onNext,
}: {
  view: SessionView;
  guard: Guard;
  onView: (v: SessionView) => void;
  onReference: (id: string) => void;
  onOffset: (id: string, ms: number | null) => void;
  onNext: () => void;
}) {
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hasReference = view.devices.some((d) => d.isReference);

  if (!view.devices.length) {
    return (
      <section className="panel narrow">
        <h2>Uhren abgleichen</h2>
        <p className="muted">Noch keine Geräte mit eigener Uhr. Sammle zuerst Aufnahmen ein.</p>
      </section>
    );
  }

  const run = async () => {
    setProgress("Starte…");
    const off = api.onProgress((p) =>
      setProgress(p.fileName ? `${p.done + 1} / ${p.total} · ${p.fileName}` : "Suche Übereinstimmungen…"),
    );
    const r = await guard(() => api.analyze(view.session.id));
    off();
    setProgress(null);
    if (!r) return;
    onView(r.view);
    const n = r.view.proposals.length;
    setNotice(
      [
        `${r.analyzed} ${r.analyzed === 1 ? "Tonspur" : "Tonspuren"} analysiert`,
        n ? `${n} ${n === 1 ? "Vorschlag" : "Vorschläge"}` : "keine neuen Vorschläge",
        ...(r.failed.length ? [`${r.failed.length} nicht lesbar`] : []),
      ].join(" · "),
    );
  };

  const span = Math.max(
    5 * 60_000,
    ...view.devices.map((d) => Math.abs(d.offsetMs ?? 0) * 1.25),
    ...view.proposals.map((p) => Math.abs(p.impliedOffsetMs ?? 0) * 1.25),
  );
  const ordered = [...view.devices].sort((a, b) => Number(b.isReference) - Number(a.isReference));

  return (
    <div className="sync">
      <section className="panel">
        <div className="section-head">
          <h2>Uhren abgleichen</h2>
          <span className="sp" />
          <button className="btn" disabled={!!progress || !hasReference || !view.avCount} onClick={() => void run()}>
            {view.analyzedCount ? "Tonspuren erneut abgleichen" : "Tonspuren abgleichen"}
          </button>
          <button className="btn pri" onClick={onNext}>
            Weiter: Durchsehen →
          </button>
        </div>
        <p className="muted small lead">
          {hasReference
            ? "Jedes Gerät hat seine eigene Uhr. Die Referenzuhr gilt als richtig; für die anderen trägst du ein, wie weit sie abweichen („Kamera geht 2:47 vor“ = +2:47), oder lässt Feldspur über Klatschen und gleiche Geräusche in den Tonspuren suchen. Vorschläge werden erst übernommen, wenn du sie bestätigst."
            : "Wähle zuerst die Referenzuhr: das Gerät, dessen Uhr am verlässlichsten lief (oft der Audiorekorder oder das Handy mit Netzzeit)."}
        </p>
        {progress && <p className="notice">{progress}</p>}
        {notice && !progress && <p className="notice">{notice}</p>}
        <div className="clocks">
          <div className="clock-scale-head">
            <span />
            <span className="scale-labels small muted">
              <span className="mono">−{mmss(span)}</span>
              <span>Referenz</span>
              <span className="mono">+{mmss(span)}</span>
            </span>
            <span />
          </div>
          {ordered.map((d) => (
            <ClockRow
              key={d.id}
              device={d}
              span={span}
              proposals={view.proposals.filter((p) => p.deviceId === d.id)}
              onReference={() => onReference(d.id)}
              onOffset={(ms) => onOffset(d.id, ms)}
              onConfirm={(id) => void guard(() => api.confirmAnchor(id)).then((v) => v && onView(v))}
              onReject={(id) => void guard(() => api.rejectAnchor(id)).then((v) => v && onView(v))}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ClockRow({
  device,
  span,
  proposals,
  onReference,
  onOffset,
  onConfirm,
  onReject,
}: {
  device: DeviceRow;
  span: number;
  proposals: ProposalRow[];
  onReference: () => void;
  onOffset: (ms: number | null) => void;
  onConfirm: (anchorId: string) => void;
  onReject: (anchorId: string) => void;
}) {
  const pos = (ms: number) => `${50 + (ms / span) * 50}%`;
  return (
    <div className={`clock ${device.isReference ? "is-ref" : ""}`} data-device={device.label}>
      <div className="clock-name">
        <span className={`glyph k-${device.kind}`}>{KIND_GLYPH[device.kind]}</span>
        <div>
          <b>{device.label}</b>
          <div className="muted small">
            {device.sourceCount} {device.sourceCount === 1 ? "Datei" : "Dateien"}
            {device.personName && ` · ${device.personName}`}
          </div>
        </div>
      </div>
      <div className="scale" aria-hidden>
        <span className="scale-zero" />
        {proposals.map(
          (p) =>
            p.impliedOffsetMs !== null && (
              <span key={p.anchorId} className="scale-mark ghost" style={{ left: pos(p.impliedOffsetMs) }} />
            ),
        )}
        {device.offsetMs !== null && (
          <span
            className={`scale-mark ${device.isReference ? "ref" : ""}`}
            style={{ left: pos(device.offsetMs) }}
            title={offsetText(device.offsetMs)}
          />
        )}
        {device.offsetMs === null && <span className="scale-unknown">Abweichung unbekannt</span>}
      </div>
      <div className="clock-value">
        {device.isReference ? (
          <span className="pill ref">Referenzuhr</span>
        ) : (
          <>
            <OffsetInput device={device} onOffset={onOffset} />
            <button className="link small" onClick={onReference}>
              als Referenz
            </button>
          </>
        )}
      </div>
      {proposals.map((p) => (
        <Proposal
          key={p.anchorId}
          p={p}
          onConfirm={() => onConfirm(p.anchorId)}
          onReject={() => onReject(p.anchorId)}
        />
      ))}
    </div>
  );
}

function OffsetInput({ device, onOffset }: { device: DeviceRow; onOffset: (ms: number | null) => void }) {
  const show = (ms: number | null) => (ms === null ? "" : offsetText(ms));
  const [text, setText] = useState(show(device.offsetMs));
  useEffect(() => setText(show(device.offsetMs)), [device.offsetMs]);
  const commit = () => {
    const ms = parseOffset(text);
    if (ms !== device.offsetMs) onOffset(ms);
  };
  return (
    <span className="offset">
      <input
        className="mono"
        value={text}
        placeholder="±m:ss"
        aria-label={`Abweichung ${device.label}`}
        disabled={device.offsetBasis === "anchor"}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className={`small ${device.offsetMs === null ? "wa" : "muted"}`}>
        {device.offsetMs === null ? "offen" : BASIS_TEXT[device.offsetBasis]}
      </span>
    </span>
  );
}

function Proposal({ p, onConfirm, onReject }: { p: ProposalRow; onConfirm: () => void; onReject: () => void }) {
  const sure = (p.confidence ?? 0) >= 0.5;
  return (
    <div className="proposal">
      <span className="proposal-tag">Vorschlag</span>
      <div className="proposal-text">
        <div>
          Uhr geht <b className="mono">{p.impliedOffset ?? "?"}</b>, gefunden in <b>{p.sourceLabel}</b>{" "}
          <span className="mono small muted">{p.fileName}</span>
        </div>
        <div className="muted small">
          {p.description} · {p.note} ·{" "}
          <span className={sure ? "st-ok" : "wa"}>{sure ? "eindeutig" : "unsicher, bitte anhören"}</span>
        </div>
      </div>
      <button className="btn pri sm" onClick={onConfirm}>
        Übernehmen
      </button>
      <button className="btn sm" onClick={onReject}>
        Verwerfen
      </button>
    </div>
  );
}
