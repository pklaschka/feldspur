/**
 * Schritt 1 „Einsammeln“: Dateien oder Ordner ablegen, danach je Gerät (`Device`) eine Karte mit seinen Quellen
 * (`sources`), ihrer Lage auf der Zeitachse und ihrem Status. Eingebunden von `app/SessionPane.tsx`.
 *
 * Das Einsammeln selbst (Dateien suchen, Metadaten und Prüfsummen lesen) läuft im Hauptprozess
 * (`apps/desktop/src/main/ipc/sessions.ts`, `packages/media`); den Stand dazu hält `importState.ts` außerhalb dieser
 * Komponente, damit er einen Wechsel des Schritts übersteht; die neue Ansicht nach dem Einsammeln übernimmt
 * `app/SessionPane.tsx`. Die Originale werden nie kopiert oder verändert.
 */
import { isScrollingList, openStatusCounts } from "./collectLayout.ts";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { DeviceRow, SessionView, SourceRow } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { bytes, dominantDay, formatDate, hm, KIND_LABEL, lage, STATUS_TEXT } from "./format.ts";
import { remainingText } from "./exportState.tsx";
import {
  cancelImport,
  dismissImportNotice,
  importPercent,
  importRemainingMs,
  startImport,
  useImport,
  type ImportJob,
} from "./importState.ts";
import { DeviceMenu, SourceMenu } from "./SourceMenu.tsx";
import { Button, cx, FlagMark, Glyph, Pill, StatusDot, StatusLegend, StepHeader, Tip } from "./ui.tsx";
import { useDraft } from "./hooks.ts";
import { isEnter } from "./keys.js";

const api = window.feldspur;

export function Collect({
  view,
  guard,
  selected,
  onSelect,
  onRename,
  onNext,
  onOpenDiary,
  onTranscribe,
  onSetDate,
}: {
  view: SessionView;
  guard: Guard;
  /** Gewählte Quelle (id); ihre Einzelheiten zeigt die Detailleiste (`Inspector.tsx`). */
  selected: string | null;
  onSelect: (id: string) => void;
  onRename: (deviceId: string, label: string) => void;
  /** Weiter zum Schritt „Abgleichen“. */
  onNext: () => void;
  /** Dialog „Tagebuch abtippen“ (`DiaryEditor.tsx`) mit dieser Seite (Quelle) öffnen. */
  onOpenDiary: (pageId: string) => void;
  /** Dialog „Mitschreiben“ (`Transcriber.tsx`) mit dieser Aufnahme öffnen. */
  onTranscribe: (sourceId: string) => void;
  /** Einsatzdatum ändern (rückgängig machbar); true, wenn es geklappt hat. */
  onSetDate: (date: string) => Promise<boolean>;
}) {
  const [hover, setHover] = useState(false);
  const sessionId = view.session.id;
  const imp = useImport();
  const job = imp.job?.sessionId === sessionId ? imp.job : null;
  // Einsammeln läuft im Hintergrund weiter, auch wenn diese Ansicht kurz verschwindet; nur eins zur Zeit.
  const busy = !!imp.job;
  const notice = imp.notices[sessionId] ?? null;

  const importPaths = (paths: string[]) => void startImport(sessionId, paths, guard);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setHover(false);
    if (busy) return;
    // Die Oberfläche kennt nur `File`-Objekte; den Pfad auf der Platte liefert die Brücke (`preload.ts`).
    importPaths([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean));
  };
  const empty = view.rows.length === 0;
  const unassigned = view.rows.filter((r) => !r.deviceId);
  // Häufigster Kalendertag laut Metadaten und Dateinamen, zum Vergleich mit dem Einsatzdatum (`DayHint`).
  const dayHint = dominantDay(view.rows);

  return (
    <div
      data-dropzone
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
      {job ? (
        <ImportRunning job={job} big={empty} />
      ) : (
        <div
          className={cx(
            "mb-5 flex items-center gap-4 rounded-xl border-[1.5px] border-dashed px-4 py-3",
            hover && !busy ? "border-accent bg-accent-soft" : "border-line-2 bg-panel-2",
            empty && "flex-col px-8 py-16 text-center",
          )}
        >
          <div className="flex-1">
            <b>{busy ? "Ein anderer Einsatz sammelt gerade ein" : "Dateien oder ganze Ordner hier ablegen"}</b>
            <div className="text-[0.85rem] text-muted">
              {busy
                ? "Sobald das fertig ist, geht es hier weiter."
                : "Video, Audio, Fotos, Tagebuchscans (JPG/PDF), Notizen (TXT/MD). Originale bleiben, wo sie sind."}
            </div>
          </div>
          <Button disabled={busy} onClick={() => void api.pickFiles().then(importPaths)}>
            Dateien wählen…
          </Button>
        </div>
      )}
      {notice?.kind === "cancelled" && (
        <div
          className="my-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-sunken px-3 py-2 text-[0.9rem]"
          role="status"
          data-testid="import-cancelled"
        >
          <span>
            <b className="font-semibold">Einsammeln abgebrochen.</b> Nichts übernommen, der Einsatz ist unverändert.
            {notice.read > 0 &&
              ` ${notice.read} von ${notice.total} Dateien waren schon gelesen; ein neuer Versuch übernimmt sie sofort, solange Feldspur offen bleibt.`}
          </span>
          <span className="flex-1" />
          <Button variant="link" className="text-[0.85rem] text-muted" onClick={() => dismissImportNotice(sessionId)}>
            Ausblenden
          </Button>
        </div>
      )}
      {notice?.kind === "done" && (
        <div
          className="my-2 rounded-lg bg-accent-soft px-3 py-2 text-[0.9rem]"
          role="status"
          data-testid="import-notice"
        >
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span>{notice.text}.</span>
            {/* Nach dem Einsammeln ist die Referenzuhr der nächste Schritt. */}
            {!view.devices.some((d) => d.isReference) && view.devices.length > 0 && (
              <Button variant="link" onClick={onNext}>
                Weiter: Referenzuhr wählen →
              </Button>
            )}
            <span className="flex-1" />
            <Button variant="link" className="text-[0.85rem] text-muted" onClick={() => dismissImportNotice(sessionId)}>
              Ausblenden
            </Button>
          </div>
          {notice.warnings.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-warn">
                {notice.warnings.length} {notice.warnings.length === 1 ? "Hinweis" : "Hinweise"} ansehen
              </summary>
              <ul className="mt-1 grid gap-0.5 pl-4 text-[0.85rem]">
                {notice.warnings.map((w, i) => (
                  <li key={i}>
                    <b className="font-medium">{w.fileName}</b>: {w.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {!job && dayHint && (
        <DayHint
          key={`${view.session.date}/${dayHint.day}/${dayHint.days}`}
          sessionDate={view.session.date}
          hint={dayHint}
          onSetDate={onSetDate}
        />
      )}
      {!empty && (
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-semibold">Geräte</h3>
            <span className="text-[0.85rem] text-muted">
              erkannt aus Kameramodell oder Dateinamen · Namen anklicken zum Ändern
            </span>
            <span className="flex-1" />
            <StatusLegend context={view.rows.some((r) => r.status === "context")} />
          </div>
          <div className="columns-[340px] gap-3.5 *:mb-3.5 *:break-inside-avoid">
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
                onTranscribe={onTranscribe}
              />
            ))}
            {unassigned.length > 0 && (
              <section className="k-other overflow-hidden rounded-xl border border-line bg-panel shadow-xs">
                <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                  <Glyph kind="other" />
                  <span className="font-semibold">Ohne Gerät</span>
                </header>
                <SourceList view={view} name="Ohne Gerät" rows={unassigned} selected={selected} onSelect={onSelect} />
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Hinweis, wenn die Dateien nach ihren Metadaten nicht zum Einsatzdatum passen (die Ausgabe heißt nach dem Datum,
 * und von Hand eingetragene Uhrzeiten gelten an diesem Tag), und sanft, wenn sie von mehreren Tagen stammen.
 */
function DayHint({
  sessionDate,
  hint,
  onSetDate,
}: {
  sessionDate: string;
  hint: { day: string; count: number; days: number };
  onSetDate: (date: string) => Promise<boolean>;
}) {
  const [hidden, setHidden] = useState(false);
  const differs = hint.day !== sessionDate;
  if (hidden || (!differs && hint.days < 2)) return null;
  return (
    <div
      className="my-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-sunken px-3 py-2 text-[0.9rem]"
      role="status"
      data-testid="day-hint"
    >
      <span>
        {differs && (
          <>
            Die meisten Dateien stammen vom {formatDate(hint.day)}, der Einsatz steht auf {formatDate(sessionDate)}.
          </>
        )}
        {hint.days > 1 &&
          ` Die Dateien stammen von ${hint.days} Tagen. Ein Einsatz ist für einen Feldtag gedacht; lege für weitere Tage eigene Einsätze an.`}
      </span>
      {differs && (
        <Button variant="link" onClick={() => void onSetDate(hint.day)}>
          Datum auf {formatDate(hint.day)} setzen
        </Button>
      )}
      <span className="flex-1" />
      <Button variant="link" className="text-[0.85rem] text-muted" onClick={() => setHidden(true)}>
        Ausblenden
      </Button>
    </div>
  );
}

/** Dateiname ohne Ordner, für Windows- und POSIX-Pfade. */
const fileOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const n = (x: number) => x.toLocaleString("de-DE");

/**
 * Fortschritt beim Einsammeln: erst Dateien suchen (Anzahl wächst), dann jede lesen und prüfen. Der Balken folgt den
 * gelesenen Bytes, weil die Prüfsummen großer Videos die Dauer bestimmen, nicht die Zahl der Dateien.
 */
function ImportRunning({ job, big }: { job: ImportJob; big: boolean }) {
  // Restzeit sekündlich auffrischen, auch wenn gerade eine große Datei ohne neue Meldung gelesen wird.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const p = job.progress;
  const reading = p?.phase === "reading";
  const pct = importPercent(p);
  const current = p?.path ? fileOf(p.path) : "";
  return (
    <section
      className={cx("mb-5 rounded-xl border border-line bg-panel px-4 py-3 shadow-xs", big && "px-8 py-10")}
      role="status"
      aria-live="polite"
      data-testid="import-progress"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b className="font-semibold">
          {job.cancelling
            ? "Bricht ab…"
            : reading
              ? "Lese Dateien, Metadaten und Prüfsummen"
              : `Suche Dateien${p ? ` · ${n(p.total)} gefunden` : "…"}`}
        </b>
        {reading && (
          <span className="text-[0.88rem] text-muted tabular-nums" data-testid="import-count">
            {n(p.done)} von {n(p.total)} Dateien · {bytes(p.bytesDone)} von {bytes(p.bytesTotal)}
          </span>
        )}
        <span className="flex-1" />
        {reading && (
          <span className="text-[0.88rem] text-muted tabular-nums">{remainingText(importRemainingMs(job, now))}</span>
        )}
        <Button size="sm" disabled={job.cancelling} onClick={cancelImport} data-testid="import-cancel">
          Abbrechen
        </Button>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-label="Einsammeln"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={reading ? pct : undefined}
      >
        <div
          className={cx("h-full rounded-full bg-accent transition-[width]", !reading && "w-1/4 animate-pulse")}
          style={reading ? { width: `${pct}%` } : undefined}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[0.85rem] text-muted">
        <span className="min-w-0 flex-1 truncate font-mono text-[0.8rem]" title={p?.path}>
          {current}
        </span>
        {reading && p.reused > 0 && <span>{n(p.reused)} aus dem letzten Versuch übernommen</span>}
      </div>
      <p className="mt-1 text-[0.85rem] text-muted">
        Erst wenn alles gelesen ist, kommt es in den Einsatz, auf einmal. Abbrechen hinterlässt nichts.
      </p>
    </section>
  );
}

/** Karte eines Geräts: Name (anklickbar zum Umbenennen), Referenzuhr und Zeitzone, darunter seine Dateien. */
function DeviceCard({
  device,
  view,
  rows,
  selected,
  onSelect,
  onRename,
  onOpenDiary,
  onTranscribe,
}: {
  device: DeviceRow;
  view: SessionView;
  rows: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRename: (label: string) => void;
  onOpenDiary: (pageId: string) => void;
  onTranscribe: (sourceId: string) => void;
}) {
  // Mitschreiben beginnt bei der ersten Aufnahme, die noch keine Zeile hat (sonst bei der ersten).
  const av = rows.filter((r) => r.kind === "audio" || r.kind === "video");
  const firstOpen = av.find((r) => !view.transcript.some((l) => l.sourceId === r.id)) ?? av[0];
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return (
    <section
      className={`k-${device.kind} overflow-hidden rounded-xl border border-line bg-panel shadow-xs`}
      data-testid="device-card"
      data-device={device.label}
    >
      <header className="flex items-center gap-2 px-3 pt-3">
        <Glyph kind={device.kind} />
        <EditableName value={device.label} onCommit={onRename} />
        {device.isReference && (
          <Pill tone="accent">
            <FlagMark size={10} className="mr-1 inline align-[-1px]" />
            Referenzuhr
          </Pill>
        )}
        {device.timeZone && <Pill>Uhr: {device.timeZone}</Pill>}
        <span className="flex-1" />
        {device.kind === "diary" && rows[0] && (
          <Button size="sm" onClick={() => onOpenDiary(rows[0]!.id)}>
            Abtippen…
          </Button>
        )}
        <DeviceMenu device={device} view={view} />
      </header>
      <div className="flex flex-wrap items-baseline gap-x-2 pr-3 pb-2 pl-[3.1rem] text-[0.85rem] text-muted">
        <span>
          {rows.length} {rows.length === 1 ? "Datei" : "Dateien"} · {kinds.map((k) => KIND_LABEL[k]).join(", ")}
          {device.personName && ` · ${device.personName}`}
        </span>
        {/* In der Unterzeile, damit der Gerätename im Kopf Platz behält. */}
        {firstOpen && (
          <Button
            variant="link"
            className="text-[0.85rem]"
            onClick={() => onTranscribe(firstOpen.id)}
            title={`${firstOpen.label} abhören und mitschreiben`}
          >
            Mitschreiben…
          </Button>
        )}
      </div>
      <SourceList view={view} name={device.label} rows={rows} selected={selected} onSelect={onSelect} />
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

/**
 * Dateien eines Geräts mit Kurzzeichen, Lage und Status. Lange Listen scrollen in der Karte und bekommen eine
 * Fußzeile mit Sprüngen zu dem, was noch offen ist (Grenze und Zählung in `collectLayout.ts`).
 */
function SourceList({
  view,
  name,
  rows,
  selected,
  onSelect,
}: {
  view: SessionView;
  name: string;
  rows: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const label = (id: string | null) => view.rows.find((r) => r.id === id)?.label ?? "?";
  const all = ordered(rows);
  const scrolling = isScrollingList(all.length);
  const listRef = useRef<HTMLUListElement>(null);
  // Ausgewählte Datei (auch aus der Suche oder über die Fußzeile) in der scrollenden Liste in Sicht holen.
  useEffect(() => {
    if (!scrolling || !selected) return;
    listRef.current?.querySelector(`[data-source-id="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [scrolling, selected]);
  const open = scrolling ? openStatusCounts(all.map((e) => e.row.status)) : [];
  return (
    <div className="border-t border-line">
      <ul
        ref={listRef}
        aria-label={`Dateien von ${name}`}
        className={cx(
          "pb-1",
          scrolling &&
            "scroll-fade max-h-[18rem] scroll-py-2 overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin]",
        )}
        data-testid="source-list"
      >
        {all.map(({ row: r, nested }) => (
          <li
            key={r.id}
            data-source-id={r.id}
            className={cx("group flex items-center pr-1.5", selected === r.id ? "bg-accent-soft" : "hover:bg-panel-2")}
          >
            <button
              data-testid="source"
              data-label={r.label}
              aria-current={selected === r.id || undefined}
              className={cx(
                "grid min-w-0 flex-1 cursor-pointer grid-cols-[3.4rem_minmax(0,1fr)_auto_8px] items-center gap-2.5 py-1.5 pr-1.5 text-left",
                nested ? "pl-7" : "pl-3",
              )}
              onClick={() => onSelect(r.id)}
            >
              <span className={`k-${r.kind} font-mono text-[0.82rem] font-medium text-k`}>
                {nested && <span className="mr-1 text-muted">↳</span>}
                {r.label}
              </span>
              <span className="min-w-0">
                <span className="block truncate" title={r.fileName}>
                  {r.fileName}
                </span>
                {r.follows && <span className="block text-[0.8rem] text-muted">setzt {label(r.follows)} fort</span>}
                {nested && <span className="block text-[0.8rem] text-muted">weiteres Bild zu {label(r.partOf)}</span>}
              </span>
              <span className="font-mono text-[0.82rem] whitespace-nowrap text-ink-2" title={lage(r.startMs, r.endMs)}>
                {r.status === "context"
                  ? "Kontext"
                  : r.startMs === null
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
      {scrolling && (
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-3 py-1.5 text-[0.85rem]"
          data-testid="source-list-footer"
        >
          <span className="text-muted">{all.length} Dateien · scrollen für alle</span>
          <span className="flex flex-wrap items-center gap-x-3">
            {open.map(({ status, count }) => (
              <Button
                key={status}
                variant="link"
                className="inline-flex items-center gap-1.5 text-[0.85rem]"
                title={
                  status === "unplaced" ? "Zur ersten Datei ohne Zeit springen" : "Zur ersten Datei zum Prüfen springen"
                }
                onClick={() => {
                  const first = all.find((e) => e.row.status === status);
                  if (first) onSelect(first.row.id);
                }}
              >
                <StatusDot status={status} decorative />
                {count} {STATUS_TEXT[status]}
              </Button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

/** Gerätename: Klick macht daraus ein Eingabefeld; Enter oder Verlassen speichert, Esc verwirft. */
function EditableName({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useDraft(value);
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
        if (isEnter(e)) commit();
        if (e.key === "Escape") {
          setText(value);
          setEditing(false);
        }
      }}
    />
  );
}
