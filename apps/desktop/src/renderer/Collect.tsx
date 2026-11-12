import { useEffect, useState, type DragEvent } from "react";
import type { DeviceRow, SessionView, SourceRow } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { KIND_GLYPH, KIND_LABEL, lage, STATUS_TEXT } from "./format.ts";

const api = window.feldspur;

export function Collect({
  view,
  guard,
  onView,
  selected,
  onSelect,
  onRename,
  onNext,
}: {
  view: SessionView;
  guard: Guard;
  onView: (v: SessionView) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onRename: (deviceId: string, label: string) => void;
  onNext: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setBusy(true);
    const r = await guard(() => api.importPaths(view.session.id, paths));
    setBusy(false);
    if (!r) return;
    onView(r.view);
    const parts = [`${r.added} ${r.added === 1 ? "Quelle" : "Quellen"} übernommen`];
    if (r.duplicates) parts.push(`${r.duplicates} schon vorhanden`);
    if (r.warnings.length) parts.push(`${r.warnings.length} Hinweise`);
    setNotice(parts.join(" · "));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setHover(false);
    void importPaths([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean));
  };
  const empty = view.rows.length === 0;
  const unassigned = view.rows.filter((r) => !r.deviceId);

  return (
    <div
      className={`collect ${hover ? "hover" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
    >
      <div className={`drop ${empty ? "big" : ""}`}>
        <div>
          <b>{busy ? "Lese Dateien, Metadaten und Prüfsummen…" : "Dateien oder ganze Ordner hier ablegen"}</b>
          <div className="muted small">
            Video, Audio, Fotos, Tagebuchscans (JPG/PDF), Notizen (TXT/MD). Originale bleiben, wo sie sind.
          </div>
        </div>
        <button className="btn" disabled={busy} onClick={() => void api.pickFiles().then(importPaths)}>
          Dateien wählen…
        </button>
      </div>
      {notice && <p className="notice">{notice}</p>}
      {!empty && (
        <>
          <div className="section-head">
            <h2>Geräte</h2>
            <span className="muted small">erkannt aus Kameramodell oder Dateinamen · Namen anklicken zum Ändern</span>
            <span className="sp" />
            <button className="btn pri" onClick={onNext}>
              Weiter: Uhren abgleichen →
            </button>
          </div>
          <div className="cards">
            {view.allDevices.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                rows={view.rows.filter((r) => r.deviceId === d.id)}
                selected={selected}
                onSelect={onSelect}
                onRename={(label) => onRename(d.id, label)}
              />
            ))}
            {unassigned.length > 0 && (
              <section className="card dev-card k-other">
                <header>
                  <span className="glyph">?</span>
                  <span className="dev-name">Ohne Gerät</span>
                </header>
                <SourceList rows={unassigned} selected={selected} onSelect={onSelect} />
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DeviceCard({
  device,
  rows,
  selected,
  onSelect,
  onRename,
}: {
  device: DeviceRow;
  rows: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRename: (label: string) => void;
}) {
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return (
    <section className={`card dev-card k-${device.kind}`} data-device={device.label}>
      <header>
        <span className="glyph">{KIND_GLYPH[device.kind]}</span>
        <EditableName value={device.label} onCommit={onRename} />
        {device.isReference && <span className="pill ref">Referenzuhr</span>}
      </header>
      <div className="dev-meta muted small">
        {rows.length} {rows.length === 1 ? "Datei" : "Dateien"} · {kinds.map((k) => KIND_LABEL[k]).join(", ")}
        {device.personName && ` · ${device.personName}`}
      </div>
      <SourceList rows={rows} selected={selected} onSelect={onSelect} />
    </section>
  );
}

function SourceList({
  rows,
  selected,
  onSelect,
}: {
  rows: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="srclist">
      {rows.map((r) => (
        <li key={r.id}>
          <button className={`src ${selected === r.id ? "on" : ""}`} onClick={() => onSelect(r.id)}>
            <span className="src-label mono">{r.label}</span>
            <span className="src-file" title={r.fileName}>
              {r.fileName}
            </span>
            <span className="src-time mono">{r.startMs === null ? "–" : lage(r.startMs, r.endMs)}</span>
            <span className={`dot st-${r.status}`} title={STATUS_TEXT[r.status]} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function EditableName({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  if (!editing) {
    return (
      <button className="dev-name editable" title="Umbenennen" onClick={() => setEditing(true)}>
        {value}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== value) onCommit(text.trim());
    else setText(value);
  };
  return (
    <input
      className="dev-name-input"
      autoFocus
      value={text}
      aria-label={`Name für ${value}`}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setText(value);
          setEditing(false);
        }
      }}
    />
  );
}
