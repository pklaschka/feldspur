import { formatDuration } from "@feldspur/core/time";
import { useEffect, useState, type ReactNode } from "react";
import { mediaUrl, type SessionView, type SourceRow } from "../shared/api.ts";
import { bytes, clock, EVIDENCE_LABEL, KIND_LABEL, lage, offsetText, STATUS_TEXT } from "./format.ts";
import { Button, cx, Eyebrow, Glyph, Pill, STATUS_TEXT_CLASS } from "./ui.tsx";

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
    <aside className="overflow-auto border-l border-line bg-panel" data-testid="inspector">
      <div className="px-4.5 pt-4 pb-6">
        {row ? <SourceDetails row={row} onClose={onClose} onDiaryNote={onDiaryNote} /> : <Summary view={view} />}
      </div>
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
  const stat = (s: SourceRow["status"]) => (
    <div className={cx("rounded-lg border border-line p-2 text-[0.78rem]", STATUS_TEXT_CLASS[s])}>
      <b className="block text-[1.3rem] font-semibold">{count(s)}</b>
      {STATUS_TEXT[s]}
    </div>
  );
  return (
    <>
      <Eyebrow className="mt-0">Überblick</Eyebrow>
      <div className="grid grid-cols-3 gap-1.5">
        {stat("ok")}
        {stat("check")}
        {stat("unplaced")}
      </div>
      <Eyebrow>Als Nächstes</Eyebrow>
      {todo.length ? (
        <ul className="grid list-disc gap-1 pl-4.5">
          {todo.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.8rem] text-good">Alles verortet. Bereit für die Ausgabe, sobald das Format steht.</p>
      )}
      <p className="mt-6 text-[0.8rem] text-muted">
        Wähle eine Quelle aus, um Vorschau, Zeitbelege und Dateiangaben zu sehen.
      </p>
    </>
  );
}

function KV({ items, small }: { items: [string, ReactNode, string?][]; small?: boolean }) {
  return (
    <dl className={cx("mt-3.5 grid grid-cols-[6.5rem_1fr] gap-x-2.5 gap-y-1", small && "text-[0.8rem]")}>
      {items.map(([k, v, cls]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className={cx("min-w-0", cls)}>{v}</dd>
        </div>
      ))}
    </dl>
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
  const items: [string, ReactNode, string?][] = [
    [
      "Lage",
      <>
        {lage(row.startMs, row.endMs)}
        {row.uncertaintyMs !== null && row.uncertaintyMs > 0 && (
          <span className="text-muted"> ± {formatDuration(row.uncertaintyMs)}</span>
        )}
      </>,
      "font-mono",
    ],
    ["Status", `● ${[STATUS_TEXT[row.status], ...row.notes].join(" · ")}`, STATUS_TEXT_CLASS[row.status]],
  ];
  if (row.durationMs !== null) items.push(["Dauer", formatDuration(row.durationMs), "font-mono"]);
  items.push([
    "Gerät",
    <>
      {row.deviceLabel || "–"}
      {row.personName && <span className="text-muted"> · {row.personName}</span>}
    </>,
  ]);
  if (row.correctionMs !== 0) items.push(["Uhrkorrektur", offsetText(row.correctionMs), "font-mono"]);

  return (
    <>
      <div className="flex items-start gap-2.5" data-testid="inspector-head">
        <Glyph kind={row.kind} />
        <div className="min-w-0">
          <b className="font-mono">{row.label}</b> <span className="text-muted">· {KIND_LABEL[row.kind]}</span>
          <div className="truncate text-[0.82rem] text-ink-2" title={row.fileName}>
            {row.fileName}
          </div>
        </div>
        <span className="flex-1" />
        <Button variant="link" onClick={onClose} aria-label="Schließen">
          ✕
        </Button>
      </div>
      {row.previewable && (
        <img
          className="mt-3.5 mb-1 block max-h-60 w-full rounded-lg border border-line bg-sunken object-contain"
          src={mediaUrl(row.id)}
          alt={`Vorschau ${row.fileName}`}
        />
      )}
      <KV items={items} />

      {row.kind === "diary" && <DiaryNote row={row} onCommit={(c) => onDiaryNote(row.id, c)} />}

      {row.idle.length > 0 && (
        <>
          <Eyebrow>Stille</Eyebrow>
          <ul className="font-mono text-[0.8rem]">
            {row.idle.map((i) => (
              <li key={i.startMs}>
                {clock(i.startMs)} – {clock(i.endMs)}
              </li>
            ))}
          </ul>
          {row.loudAtMs.length > 0 && (
            <p className="mt-1 text-[0.8rem] text-warn">
              Laut in der Stille: {row.loudAtMs.slice(0, 5).map(clock).join(", ")}
              {row.loudAtMs.length > 5 ? " …" : ""}
            </p>
          )}
        </>
      )}

      <Eyebrow>Zeitbelege</Eyebrow>
      {row.evidence.length ? (
        <ul className="grid gap-1.5">
          {row.evidence.map((e, i) => (
            <li
              key={i}
              className={cx(
                "grid grid-cols-[1fr_auto] rounded-[7px] border px-2 py-1.5",
                e.chosen ? "border-accent bg-accent-soft" : "border-line",
                !e.enabled && "line-through opacity-55",
              )}
            >
              <span className="text-[0.72rem] font-semibold tracking-[0.04em] text-muted uppercase">
                {EVIDENCE_LABEL[e.kind] ?? e.kind}
              </span>
              <span>{e.chosen && <Pill>verwendet</Pill>}</span>
              <span className="col-span-2 [overflow-wrap:anywhere]">{e.detail}</span>
              {e.raw && (
                <span className="col-span-2 font-mono text-[0.8rem] [overflow-wrap:anywhere] text-muted">{e.raw}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.8rem] text-muted">
          {row.kind === "diary" && row.diaryNote
            ? "Zeit aus der Randnotiz."
            : "Keine Zeit in Metadaten oder Dateiname gefunden."}
        </p>
      )}

      <Eyebrow>Datei</Eyebrow>
      <KV
        small
        items={[
          ["Größe", bytes(row.sizeBytes)],
          [
            "SHA-256",
            <span key="sha" title={row.sha256}>
              {row.sha256.slice(0, 16)}…
            </span>,
            "font-mono",
          ],
          [
            "Original",
            <span key="p" title={row.originalPath}>
              {row.originalPath}
            </span>,
            "text-[0.75rem] text-ink-2 [overflow-wrap:anywhere]",
          ],
        ]}
      />
    </>
  );
}

function DiaryNote({ row, onCommit }: { row: SourceRow; onCommit: (clock: string) => void }) {
  const [text, setText] = useState(row.diaryNote ?? "");
  useEffect(() => setText(row.diaryNote ?? ""), [row.diaryNote, row.id]);
  const commit = () => text !== (row.diaryNote ?? "") && onCommit(text);
  return (
    <div className="mt-3.5 rounded-lg bg-k-diary/10 p-3">
      <label className="flex items-center gap-3">
        <span className="text-[0.7rem] font-semibold tracking-[0.06em] text-k-diary uppercase">Randnotiz</span>
        <input
          className="w-[5.5rem] font-mono"
          value={text}
          placeholder="hh:mm"
          aria-label={`Randnotiz ${row.label}`}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </label>
      <p className="mt-1.5 text-[0.8rem] text-muted">
        {row.diaryWindow
          ? `Bezieht sich auf ${clock(row.diaryWindow.fromMs).slice(0, 5)}–${clock(row.diaryWindow.toMs).slice(0, 5)}. Notiert wird meist etwas später; der Zeitraum reicht deshalb zurück.`
          : "Uhrzeit, die am Rand der Seite steht. Daraus ergibt sich, auf welchen Zeitraum sich die Seite bezieht."}
      </p>
    </div>
  );
}
