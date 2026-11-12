import { useEffect, useState } from "react";
import { mediaUrl, type SessionView, type SourceRow } from "../shared/api.ts";
import { bytes, clock, EVIDENCE_LABEL, KIND_GLYPH, KIND_LABEL, lage, offsetText, STATUS_TEXT } from "./format.ts";
import { formatDuration } from "@feldspur/core/time";

export function Inspector({
  view,
  row,
  onClose,
  onDiaryNote,
}: {
  view: SessionView;
  row: SourceRow | null;
  onClose: () => void;
  onDiaryNote: (sourceId: string, clock: string) => void;
}) {
  return (
    <aside className="inspector">
      {row ? <SourceDetails row={row} onClose={onClose} onDiaryNote={onDiaryNote} /> : <Summary view={view} />}
    </aside>
  );
}

function Summary({ view }: { view: SessionView }) {
  const count = (s: SourceRow["status"]) => view.rows.filter((r) => r.status === s).length;
  const hasRef = view.devices.some((d) => d.isReference);
  const open = view.devices.filter((d) => !d.isReference && d.offsetMs === null);
  const todo: string[] = [];
  if (!view.rows.length) todo.push("Dateien des Einsatzes einsammeln.");
  if (view.devices.length && !hasRef) todo.push("Eine Referenzuhr wählen.");
  if (hasRef && open.length) todo.push(`Abweichung für ${open.map((d) => d.label).join(", ")} klären.`);
  if (view.proposals.length) todo.push(`${view.proposals.length} Vorschläge aus der Tonspur prüfen.`);
  if (view.avCount && !view.analyzedCount) todo.push("Tonspuren abgleichen, damit Episoden und Stille erkannt werden.");
  const diaryOpen = view.rows.filter((r) => r.kind === "diary" && !r.diaryNote).length;
  if (diaryOpen) todo.push(`${diaryOpen} Tagebuchseiten ohne Randnotiz.`);
  return (
    <div className="insp-body">
      <div className="eyebrow">Überblick</div>
      <div className="stats">
        <div className="st-ok">
          <b>{count("ok")}</b> sicher
        </div>
        <div className="st-check">
          <b>{count("check")}</b> prüfen
        </div>
        <div className="st-unplaced">
          <b>{count("unplaced")}</b> ohne Zeit
        </div>
      </div>
      <div className="eyebrow">Als Nächstes</div>
      {todo.length ? (
        <ul className="todo">
          {todo.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="small st-ok">Alles verortet. Bereit für die Ausgabe, sobald das Format steht.</p>
      )}
      <p className="muted small hint">Wähle eine Quelle aus, um Vorschau, Zeitbelege und Dateiangaben zu sehen.</p>
    </div>
  );
}

function SourceDetails({
  row,
  onClose,
  onDiaryNote,
}: {
  row: SourceRow;
  onClose: () => void;
  onDiaryNote: (sourceId: string, clock: string) => void;
}) {
  return (
    <div className="insp-body">
      <div className="insp-head">
        <span className={`glyph k-${row.kind}`}>{KIND_GLYPH[row.kind]}</span>
        <div>
          <b className="mono">{row.label}</b> <span className="muted">· {KIND_LABEL[row.kind]}</span>
          <div className="insp-file" title={row.fileName}>
            {row.fileName}
          </div>
        </div>
        <span className="sp" />
        <button className="link" onClick={onClose} aria-label="Schließen">
          ✕
        </button>
      </div>
      {row.previewable && <img className="preview" src={mediaUrl(row.id)} alt={`Vorschau ${row.fileName}`} />}

      <dl className="kv">
        <dt>Lage</dt>
        <dd className="mono">
          {lage(row.startMs, row.endMs)}
          {row.uncertaintyMs !== null && row.uncertaintyMs > 0 && (
            <span className="muted"> ± {formatDuration(row.uncertaintyMs)}</span>
          )}
        </dd>
        <dt>Status</dt>
        <dd className={`st-${row.status}`}>● {[STATUS_TEXT[row.status], ...row.notes].join(" · ")}</dd>
        {row.durationMs !== null && (
          <>
            <dt>Dauer</dt>
            <dd className="mono">{formatDuration(row.durationMs)}</dd>
          </>
        )}
        <dt>Gerät</dt>
        <dd>
          {row.deviceLabel || "–"}
          {row.personName && <span className="muted"> · {row.personName}</span>}
        </dd>
        {row.correctionMs !== 0 && (
          <>
            <dt>Uhrkorrektur</dt>
            <dd className="mono">{offsetText(row.correctionMs)}</dd>
          </>
        )}
      </dl>

      {row.kind === "diary" && <DiaryNote row={row} onCommit={(c) => onDiaryNote(row.id, c)} />}

      {row.idle.length > 0 && (
        <>
          <div className="eyebrow">Stille</div>
          <ul className="plain small mono">
            {row.idle.map((i) => (
              <li key={i.startMs}>
                {clock(i.startMs)} – {clock(i.endMs)}
              </li>
            ))}
          </ul>
          {row.loudAtMs.length > 0 && (
            <p className="small wa">
              Laut in der Stille: {row.loudAtMs.slice(0, 5).map(clock).join(", ")}
              {row.loudAtMs.length > 5 ? " …" : ""}
            </p>
          )}
        </>
      )}

      <div className="eyebrow">Zeitbelege</div>
      {row.evidence.length ? (
        <ul className="evidence">
          {row.evidence.map((e, i) => (
            <li key={i} className={`${e.chosen ? "chosen" : ""} ${e.enabled ? "" : "off"}`}>
              <span className="ev-kind">{EVIDENCE_LABEL[e.kind] ?? e.kind}</span>
              <span className="ev-detail">{e.detail}</span>
              {e.raw && <span className="ev-raw mono small muted">{e.raw}</span>}
              {e.chosen && <span className="pill">verwendet</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          {row.kind === "diary" && row.diaryNote
            ? "Zeit aus der Randnotiz."
            : "Keine Zeit in Metadaten oder Dateiname gefunden."}
        </p>
      )}

      <div className="eyebrow">Datei</div>
      <dl className="kv small">
        <dt>Größe</dt>
        <dd>{bytes(row.sizeBytes)}</dd>
        <dt>SHA-256</dt>
        <dd className="mono" title={row.sha256}>
          {row.sha256.slice(0, 16)}…
        </dd>
        <dt>Original</dt>
        <dd className="path" title={row.originalPath}>
          {row.originalPath}
        </dd>
      </dl>
    </div>
  );
}

function DiaryNote({ row, onCommit }: { row: SourceRow; onCommit: (clock: string) => void }) {
  const [text, setText] = useState(row.diaryNote ?? "");
  useEffect(() => setText(row.diaryNote ?? ""), [row.diaryNote, row.id]);
  const commit = () => text !== (row.diaryNote ?? "") && onCommit(text);
  return (
    <div className="diary-note">
      <label>
        <span className="eyebrow">Randnotiz</span>
        <input
          className="mono"
          value={text}
          placeholder="hh:mm"
          aria-label={`Randnotiz ${row.label}`}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </label>
      <p className="muted small">
        {row.diaryWindow
          ? `Bezieht sich auf ${clock(row.diaryWindow.fromMs).slice(0, 5)}–${clock(row.diaryWindow.toMs).slice(0, 5)}. Notiert wird meist etwas später; der Zeitraum reicht deshalb zurück.`
          : "Uhrzeit, die am Rand der Seite steht. Daraus ergibt sich, auf welchen Zeitraum sich die Seite bezieht."}
      </p>
    </div>
  );
}
