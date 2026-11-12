import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from "react";
import type { DeviceRow, ProjectInfo, SessionView, SourceRow } from "../shared/api.ts";
import { KIND_LABEL, lage, offsetText, parseOffset } from "./format.ts";

const api = window.feldspur;

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null);
      return await fn();
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      return undefined;
    }
  }, []);

  useEffect(() => {
    void api.currentProject().then((p) => {
      setProject(p);
      setSessionId(p?.sessions[0]?.id ?? null);
    });
  }, []);

  const adopt = (p: ProjectInfo | null | undefined) => {
    if (!p) return;
    setProject(p);
    setSessionId(p.sessions.at(-1)?.id ?? null);
  };

  if (!project) {
    return (
      <main className="welcome">
        <h1>Feldspur</h1>
        <p>Alle Aufzeichnungen eines Feldeinsatzes auf einer gemeinsamen Uhrzeit-Achse.</p>
        <div className="row">
          <button className="btn pri" onClick={() => void guard(api.newProject).then(adopt)}>
            Neues Projekt
          </button>
          <button className="btn" onClick={() => void guard(api.openProject).then(adopt)}>
            Projekt öffnen…
          </button>
        </div>
        {error && <p className="err">{error}</p>}
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="eyebrow">Einsätze</div>
        {project.sessions.map((s) => (
          <button key={s.id} className={`it ${s.id === sessionId ? "on" : ""}`} onClick={() => setSessionId(s.id)}>
            {formatDay(s.date)} {s.title}
          </button>
        ))}
        <NewSessionForm onCreate={(input) => void guard(() => api.createSession(input)).then(adopt)} />
      </aside>
      <section className="content">
        {error && <p className="err">{error}</p>}
        {sessionId ? (
          <SessionPane key={sessionId} sessionId={sessionId} guard={guard} />
        ) : (
          <p className="muted pad">Lege links einen Einsatz an, zum Beispiel „Wochenmarkt Südstadt“.</p>
        )}
      </section>
    </div>
  );
}

function formatDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}.${m}.`;
}

function NewSessionForm({ onCreate }: { onCreate: (i: { title: string; date: string; place: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  if (!open) {
    return (
      <button className="it muted" onClick={() => setOpen(true)}>
        + neuer Einsatz
      </button>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), date, place: "" });
    setOpen(false);
    setTitle("");
  };
  return (
    <form className="newsession" onSubmit={submit}>
      <input
        autoFocus
        placeholder="Titel"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Titel"
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Datum" />
      <div className="row">
        <button className="btn pri" type="submit">
          Anlegen
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

function SessionPane({ sessionId, guard }: { sessionId: string; guard: Guard }) {
  const [view, setView] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void guard(() => api.getSession(sessionId)).then((v) => v && setView(v));
  }, [sessionId, guard]);

  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setBusy(true);
    const r = await guard(() => api.importPaths(sessionId, paths));
    setBusy(false);
    if (!r) return;
    setView(r.view);
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

  if (!view) return <p className="muted pad">Lade…</p>;

  return (
    <div className="pane">
      <header className="bar">
        <span className="ttl">
          {formatDay(view.session.date)} {view.session.title}
        </span>
        <span className="sp" />
        <button className="btn" disabled={busy} onClick={() => void api.pickFiles().then(importPaths)}>
          + Dateien
        </button>
      </header>
      <div
        className={`drop ${hover ? "hover" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
      >
        {busy
          ? "Lese Dateien, Metadaten und Prüfsummen…"
          : "Dateien oder Ordner hier ablegen · Scans (PDF/JPG), Video, Audio, Fotos, Notizen (TXT/MD)"}
      </div>
      {notice && <p className="notice">{notice}</p>}
      <SourceTable
        rows={view.rows}
        onDiaryNote={(id, clock) => void guard(() => api.setDiaryNote(id, clock)).then((v) => v && setView(v))}
      />
      {view.devices.length > 0 && (
        <DevicePanel
          devices={view.devices}
          onReference={(id) => void guard(() => api.setReference(id)).then((v) => v && setView(v))}
          onOffset={(id, ms) => void guard(() => api.setDeviceOffset(id, ms)).then((v) => v && setView(v))}
        />
      )}
    </div>
  );
}

const STATUS_TEXT = { ok: "sicher", check: "prüfen", unplaced: "zuordnen" } as const;

function SourceTable({
  rows,
  onDiaryNote,
}: {
  rows: SourceRow[];
  onDiaryNote: (sourceId: string, clock: string) => void;
}) {
  if (!rows.length) return <p className="muted pad">Noch keine Quellen in diesem Einsatz.</p>;
  return (
    <div className="scroll">
      <table className="src">
        <thead>
          <tr>
            <th>Quelle</th>
            <th>Datei</th>
            <th>Gerät · Person</th>
            <th>Zeit erkannt aus</th>
            <th>Lage</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <span className={`chip k-${r.kind}`}>
                  <span className="sw" />
                  {r.label} · {KIND_LABEL[r.kind]}
                </span>
              </td>
              <td className="file">{r.fileName}</td>
              <td>
                {r.deviceLabel}
                {r.personName && <span className="muted"> · {r.personName}</span>}
              </td>
              <td>
                {r.kind === "diary" ? (
                  <DiaryNoteInput row={r} onCommit={(clock) => onDiaryNote(r.id, clock)} />
                ) : (
                  r.basis
                )}
              </td>
              <td className="mono">{lage(r.startMs, r.endMs)}</td>
              <td className={`st-${r.status}`}>● {[STATUS_TEXT[r.status], ...r.notes].join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiaryNoteInput({ row, onCommit }: { row: SourceRow; onCommit: (clock: string) => void }) {
  const [text, setText] = useState(row.diaryNote ?? "");
  useEffect(() => setText(row.diaryNote ?? ""), [row.diaryNote]);
  const commit = () => text !== (row.diaryNote ?? "") && onCommit(text);
  return (
    <span className="offset">
      <span>Randnotiz</span>
      <input
        className="mono note"
        value={text}
        placeholder="hh:mm"
        aria-label={`Randnotiz ${row.label}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </span>
  );
}

const BASIS_TEXT = { reference: "Referenz", manual: "von Hand", anchor: "aus Anker", unknown: "" } as const;

function DevicePanel({
  devices,
  onReference,
  onOffset,
}: {
  devices: DeviceRow[];
  onReference: (id: string) => void;
  onOffset: (id: string, ms: number | null) => void;
}) {
  return (
    <section className="devices">
      <h3>Geräteuhren</h3>
      <p className="muted small">
        Eine Uhr ist die Referenz. Für die anderen trägst du die Abweichung ein („Kamera geht 2:47 vor“ = +2:47) oder
        setzt später Anker.
      </p>
      {devices.map((d) => (
        <div className="dev" key={d.id}>
          <label className="refpick">
            <input type="radio" name="reference" checked={d.isReference} onChange={() => onReference(d.id)} />
            <span>{d.label}</span>
            <span className="muted small">
              {d.sourceCount} {d.sourceCount === 1 ? "Quelle" : "Quellen"}
            </span>
          </label>
          {d.isReference ? (
            <span className="mono">± 0:00 · Referenz</span>
          ) : (
            <OffsetInput device={d} onOffset={onOffset} />
          )}
        </div>
      ))}
    </section>
  );
}

function OffsetInput({ device, onOffset }: { device: DeviceRow; onOffset: (id: string, ms: number | null) => void }) {
  const [text, setText] = useState(device.offsetMs === null ? "" : offsetText(device.offsetMs));
  useEffect(() => setText(device.offsetMs === null ? "" : offsetText(device.offsetMs)), [device.offsetMs]);
  const commit = () => {
    const ms = parseOffset(text);
    if (ms !== device.offsetMs) onOffset(device.id, ms);
  };
  return (
    <span className="offset">
      <input
        className="mono"
        value={text}
        placeholder="unbekannt"
        aria-label={`Abweichung ${device.label}`}
        disabled={device.offsetBasis === "anchor"}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className={`muted small ${device.offsetMs === null ? "wa" : ""}`}>
        {device.offsetMs === null ? "Uhr weicht ab?" : BASIS_TEXT[device.offsetBasis]}
      </span>
    </span>
  );
}
