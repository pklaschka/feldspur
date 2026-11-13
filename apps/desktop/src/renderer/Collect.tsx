import { useEffect, useState, type DragEvent } from "react";
import type { DeviceRow, SessionView, SourceRow } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { hm, KIND_LABEL, lage, STATUS_TEXT } from "./format.ts";
import { DeviceMenu, SourceMenu } from "./SourceMenu.tsx";
import { Button, cx, Glyph, Notice, Pill, StatusDot, StatusLegend, StepHeader, Tip } from "./ui.tsx";

const api = window.feldspur;

export function Collect({
  view,
  guard,
  onView,
  selected,
  onSelect,
  onRename,
  onNext,
  onOpenDiary,
}: {
  view: SessionView;
  guard: Guard;
  onView: (v: SessionView) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onRename: (deviceId: string, label: string) => void;
  onNext: () => void;
  onOpenDiary: (pageId: string) => void;
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
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
    >
      <StepHeader
        title="Einsammeln"
        summary={
          empty
            ? "Alle Aufzeichnungen dieses Einsatzes hierher ziehen."
            : `${view.rows.length} ${view.rows.length === 1 ? "Quelle" : "Quellen"} von ${view.allDevices.length} ${view.allDevices.length === 1 ? "Gerät" : "Geräten"}.`
        }
      >
        {!empty && (
          <Button variant="primary" onClick={onNext}>
            Weiter: Uhren abgleichen →
          </Button>
        )}
      </StepHeader>
      <div
        className={cx(
          "mb-5 flex items-center gap-4 rounded-[10px] border-[1.5px] border-dashed px-4 py-3",
          hover ? "border-accent bg-accent-soft" : "border-line-2 bg-panel-2",
          empty && "flex-col px-8 py-16 text-center",
        )}
      >
        <div className="flex-1">
          <b>{busy ? "Lese Dateien, Metadaten und Prüfsummen…" : "Dateien oder ganze Ordner hier ablegen"}</b>
          <div className="text-[0.8rem] text-muted">
            Video, Audio, Fotos, Tagebuchscans (JPG/PDF), Notizen (TXT/MD). Originale bleiben, wo sie sind.
          </div>
        </div>
        <Button disabled={busy} onClick={() => void api.pickFiles().then(importPaths)}>
          Dateien wählen…
        </Button>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {!empty && (
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-semibold">Geräte</h3>
            <span className="text-[0.8rem] text-muted">
              erkannt aus Kameramodell oder Dateinamen · Namen anklicken zum Ändern
            </span>
            <span className="flex-1" />
            <StatusLegend />
          </div>
          <div className="columns-[300px] gap-3.5 *:mb-3.5 *:break-inside-avoid">
            {view.allDevices.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                view={view}
                rows={view.rows.filter((r) => r.deviceId === d.id)}
                selected={selected}
                onSelect={onSelect}
                onRename={(label) => onRename(d.id, label)}
                onOpenDiary={onOpenDiary}
              />
            ))}
            {unassigned.length > 0 && (
              <section className="k-other overflow-hidden rounded-[10px] border border-t-[3px] border-line border-t-k bg-panel shadow-xs">
                <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                  <Glyph kind="other" />
                  <span className="font-semibold">Ohne Gerät</span>
                </header>
                <SourceList view={view} rows={unassigned} selected={selected} onSelect={onSelect} />
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
  view,
  rows,
  selected,
  onSelect,
  onRename,
  onOpenDiary,
}: {
  device: DeviceRow;
  view: SessionView;
  rows: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRename: (label: string) => void;
  onOpenDiary: (pageId: string) => void;
}) {
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return (
    <section
      className={`k-${device.kind} overflow-hidden rounded-[10px] border border-t-[3px] border-line border-t-k bg-panel shadow-xs`}
      data-testid="device-card"
      data-device={device.label}
    >
      <header className="flex items-center gap-2 px-3 pt-3">
        <Glyph kind={device.kind} />
        <EditableName value={device.label} onCommit={onRename} />
        {device.isReference && <Pill tone="accent">Referenzuhr</Pill>}
        <span className="flex-1" />
        {device.kind === "diary" && rows[0] && (
          <Button size="sm" onClick={() => onOpenDiary(rows[0]!.id)}>
            Abtippen…
          </Button>
        )}
        <DeviceMenu device={device} view={view} />
      </header>
      <div className="pr-3 pb-2 pl-[3.1rem] text-[0.8rem] text-muted">
        {rows.length} {rows.length === 1 ? "Datei" : "Dateien"} · {kinds.map((k) => KIND_LABEL[k]).join(", ")}
        {device.personName && ` · ${device.personName}`}
      </div>
      <SourceList view={view} rows={rows} selected={selected} onSelect={onSelect} />
    </section>
  );
}

/** Weitere Bilder einer Seite stehen eingerückt unter ihrer Hauptquelle. */
function ordered(rows: SourceRow[]): { row: SourceRow; nested: boolean }[] {
  const ids = new Set(rows.map((r) => r.id));
  const out: { row: SourceRow; nested: boolean }[] = [];
  for (const r of rows) {
    if (r.partOf && ids.has(r.partOf)) continue;
    out.push({ row: r, nested: false });
    for (const p of rows.filter((x) => x.partOf === r.id)) out.push({ row: p, nested: true });
  }
  return out;
}

function SourceList({
  view,
  rows,
  selected,
  onSelect,
}: {
  view: SessionView;
  rows: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const label = (id: string | null) => view.rows.find((r) => r.id === id)?.label ?? "?";
  return (
    <ul className="border-t border-line pb-1">
      {ordered(rows).map(({ row: r, nested }) => (
        <li
          key={r.id}
          className={cx("group flex items-center pr-1.5", selected === r.id ? "bg-accent-soft" : "hover:bg-panel-2")}
        >
          <button
            data-testid="source"
            data-label={r.label}
            className={cx(
              "grid min-w-0 flex-1 cursor-pointer grid-cols-[3.4rem_minmax(0,1fr)_auto_8px] items-center gap-2.5 py-1.5 pr-1.5 text-left",
              nested ? "pl-7" : "pl-3",
            )}
            onClick={() => onSelect(r.id)}
          >
            <span className={`k-${r.kind} font-mono text-[0.78rem] font-medium text-k`}>
              {nested && <span className="mr-1 text-muted">↳</span>}
              {r.label}
            </span>
            <span className="min-w-0">
              <span className="block truncate" title={r.fileName}>
                {r.fileName}
              </span>
              {r.follows && <span className="block text-[0.75rem] text-muted">setzt {label(r.follows)} fort</span>}
              {nested && <span className="block text-[0.75rem] text-muted">weiteres Bild zu {label(r.partOf)}</span>}
            </span>
            <span className="font-mono text-[0.78rem] whitespace-nowrap text-ink-2" title={lage(r.startMs, r.endMs)}>
              {r.startMs === null
                ? "–"
                : r.endMs !== null && r.endMs !== r.startMs
                  ? `${hm(r.startMs)}–${hm(r.endMs)}`
                  : lage(r.startMs, null)}
            </span>
            <Tip content={STATUS_TEXT[r.status]}>
              <span>
                <StatusDot status={r.status} />
              </span>
            </Tip>
          </button>
          <SourceMenu row={r} view={view} />
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
      <button
        data-testid="device-name"
        className="-ml-1 min-w-0 cursor-text truncate rounded-[5px] px-1 py-0.5 text-left font-semibold hover:bg-sunken"
        title="Umbenennen"
        onClick={() => setEditing(true)}
      >
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
      className="min-w-0 flex-1 font-semibold"
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
