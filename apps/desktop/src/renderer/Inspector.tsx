import { formatDuration } from "@feldspur/core/time";
import { useState, type ReactNode } from "react";
import { mediaUrl, type ContextRow, type SessionView, type SourceRow } from "../shared/api.ts";
import { ContextPanel } from "./context/ContextPanel.tsx";
import { bytes, clock, KIND_LABEL, lage, offsetText, STATUS_TEXT } from "./format.ts";
import { NotesPanel } from "./Notes.tsx";
import { PageNumbering } from "./PageNumbering.tsx";
import { PdfPageCanvas } from "./pdf.tsx";
import { usePlayback } from "./playback.tsx";
import { SourceMenu, useActions } from "./SourceMenu.tsx";
import type { Step } from "./App.tsx";
import { Button, CloseButton, cx, Eyebrow, Glyph, StatusDot, STATUS_TEXT_CLASS } from "./ui.tsx";
import type { InspectorActions } from "./inspector/actions.ts";
import type { Todo } from "./inspector/status.ts";
import { Summary } from "./inspector/Summary.tsx";
import { FILE_STATE_TEXT, needsRelink } from "./Originals.tsx";
import { Fold, KV } from "./inspector/parts.tsx";
import { CheckPanel } from "./inspector/CheckPanel.tsx";
import { ConflictPanel } from "./inspector/ConflictPanel.tsx";
import { DiaryPage } from "./inspector/DiaryPage.tsx";
import { EvidenceList, TimeForm } from "./inspector/Evidence.tsx";
import { LevelPanel } from "./inspector/LevelPanel.tsx";
import { Player } from "./inspector/Player.tsx";
import { TranscriptImport, TranscriptSummary } from "./inspector/Transcript.tsx";

const api = window.feldspur;

export function Inspector({
  view,
  row,
  context = null,
  step,
  onClose,
  onGo,
  actions,
}: {
  view: SessionView;
  row: SourceRow | null;
  /** Gewähltes Kontextstück (auch ein Kontext-Eintrag ohne eigene Quelle). */
  context?: ContextRow | null;
  /** Aktueller Schritt: bestimmt, was oben steht. */
  step: Step;
  onClose: () => void;
  onGo: (t: Todo) => void;
  actions: InspectorActions;
}) {
  return (
    <aside className="min-w-0 overflow-x-hidden overflow-y-auto border-l border-line bg-panel" data-testid="inspector">
      <div className="px-4.5 pt-4 pb-6">
        {row ? (
          <SourceDetails
            key={row.id}
            row={row}
            view={view}
            step={step}
            context={context}
            onClose={onClose}
            actions={actions}
          />
        ) : context ? (
          <ContextPanel
            key={context.key}
            c={context}
            view={view}
            apply={actions.apply}
            onOpenDiary={actions.openDiary}
            onClose={onClose}
            standalone
          />
        ) : (
          <Summary view={view} onGo={onGo} compact={step === "export"} />
        )}
      </div>
    </aside>
  );
}

function SourceDetails({
  row,
  view,
  step,
  context,
  onClose,
  actions,
}: {
  row: SourceRow;
  view: SessionView;
  step: Step;
  context: ContextRow | null;
  onClose: () => void;
  actions: InspectorActions;
}) {
  // In Durchsehen ist das Prüfen die Hauptsache: dann steht es oben, vor Player und Vorschau.
  const checkFirst = step === "review";
  const items: [string, ReactNode, string?][] = [
    [
      "Lage",
      <>
        <span className="whitespace-nowrap">
          {row.status === "context" ? "bewusst ohne Uhrzeit" : lage(row.startMs, row.endMs)}
        </span>
        {row.uncertaintyMs !== null && row.uncertaintyMs > 0 && (
          <span className="block text-[0.85rem] text-muted">± {formatDuration(row.uncertaintyMs)}</span>
        )}
      </>,
      "font-mono",
    ],
    [
      "Status",
      <>
        <span className={cx("inline-flex items-center gap-1.5", STATUS_TEXT_CLASS[row.status])}>
          <StatusDot status={row.status} decorative />
          {STATUS_TEXT[row.status]}
        </span>
        {row.notes.length > 0 && <span className="block text-[0.85rem] text-muted">{row.notes.join(" · ")}</span>}
      </>,
    ],
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
  const byId = (id: string | null) => view.rows.find((r) => r.id === id);
  const main = byId(row.partOf);
  if (main)
    items.push([
      "Seite",
      <>
        weiteres Bild zu <b className="font-mono">{main.label}</b>
      </>,
    ]);
  if (row.parts.length) {
    items.push([
      "Seite",
      <>
        mit {row.parts.length} weiteren {row.parts.length === 1 ? "Bild" : "Bildern"}:{" "}
        <span className="font-mono">{row.parts.map((id) => byId(id)?.label ?? "?").join(", ")}</span>
      </>,
    ]);
  }
  if (row.follows) items.push(["Fortsetzung von", byId(row.follows)?.label ?? "?", "font-mono"]);
  if (row.followedBy) items.push(["Fortgesetzt in", byId(row.followedBy)?.label ?? "?", "font-mono"]);
  const pageIds = new Set([main?.id ?? row.id, ...(main ? main.parts : row.parts)]);
  const sa = useActions();
  const { position, seek } = usePlayback();
  // „Keine der beiden: Uhrzeit von Hand eintragen“ öffnet das Formular unten (neu aufgebaut, schon offen).
  const [manualAsk, setManualAsk] = useState(0);
  const openManual = () => {
    setManualAsk((n) => n + 1);
    requestAnimationFrame(() =>
      document.querySelector("[data-testid=time-form]")?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  };
  const conflictShown = row.conflict.state !== "none";
  const check = conflictShown ? (
    <ConflictPanel row={row} view={view} actions={actions} onManual={openManual} />
  ) : (
    <CheckPanel row={row} view={view} actions={actions} />
  );

  return (
    <>
      <div className="flex items-start gap-2.5" data-testid="inspector-head">
        <Glyph kind={row.kind} />
        <div className="min-w-0">
          <b className="font-mono">{row.label}</b> <span className="text-muted">· {KIND_LABEL[row.kind]}</span>
          <div className="truncate text-[0.86rem] text-ink-2" title={row.fileName}>
            {row.fileName}
          </div>
        </div>
        <span className="flex-1" />
        <span className="-mt-1 -mr-1.5 flex">
          <SourceMenu row={row} view={view} />
          <CloseButton onClick={onClose} />
        </span>
      </div>
      {needsRelink(row) && (
        <div
          className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[0.86rem]"
          role="status"
          data-testid="original-missing"
        >
          <p className="text-warn">
            <b className="font-semibold">Originaldatei {FILE_STATE_TEXT[row.file]}.</b> {row.fileDetail}.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => actions.relinkOriginal(row.id)}>
              Datei wählen…
            </Button>
            <Button size="sm" variant="ghost" onClick={actions.openOriginals}>
              Alle Originale…
            </Button>
          </div>
        </div>
      )}
      {context && <ContextPanel c={context} view={view} apply={actions.apply} onOpenDiary={actions.openDiary} />}
      {!context && row.status === "unplaced" && !row.partOf && row.kind !== "audio" && row.kind !== "video" && (
        <NotInChronology
          diary={row.kind === "diary"}
          onContext={() => actions.apply(() => api.setContext(`source:${row.id}`, true))}
        />
      )}
      {checkFirst && !context && check}
      {(row.kind === "audio" || row.kind === "video") && (
        <>
          <Player row={row} />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button size="sm" onClick={() => sa.preview(row.id)}>
              Groß ansehen…
            </Button>
            <TranscriptImport view={view} row={row} onImport={actions.importTranscript} />
            <Button size="sm" variant="primary" onClick={() => actions.transcribe(row.id)}>
              Mitschreiben…
            </Button>
          </div>
          <TranscriptSummary view={view} row={row} />
          {row.level && <LevelPanel row={row} level={row.level} actions={actions} />}
        </>
      )}
      {(row.kind === "photo" || row.kind === "diary") && !row.previewable && !row.isPdf && (
        <p className="mt-3.5 rounded-lg bg-warn-soft px-3 py-2 text-[0.85rem] text-warn" data-testid="no-preview">
          Keine Vorschau: Feldspur zeigt Bilder als JPEG, PNG, WebP oder GIF. Die Zeit liest es trotzdem. Zum Ansehen
          und Abtippen wandle die Datei selbst um; siehe Handbuch, „Formate“.
        </p>
      )}
      {(row.previewable || row.isPdf) && (
        <button
          type="button"
          className="group relative mt-3.5 mb-1 block w-full cursor-zoom-in overflow-hidden rounded-lg border border-line bg-sunken"
          onClick={() => sa.preview(row.id)}
          aria-label={`${row.fileName} groß ansehen`}
        >
          {row.isPdf ? (
            <div className="max-h-60 overflow-hidden bg-white">
              <PdfPageCanvas sourceId={row.id} page={0} maxWidth={320} className="block" />
            </div>
          ) : (
            <img
              className="block max-h-60 w-full object-contain"
              src={mediaUrl(row.id)}
              alt={`Vorschau ${row.fileName}`}
            />
          )}
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[0.78rem] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            Groß ansehen…
          </span>
        </button>
      )}
      <KV items={items} />
      {!checkFirst && !context && check}

      <div className="mt-3">
        <NotesPanel
          row={row}
          notes={view.notes.filter((n) => n.sourceId === row.id)}
          pos={position?.sourceId === row.id ? position.atMs : row.kind === "audio" || row.kind === "video" ? 0 : null}
          apply={actions.apply}
          onSeek={(ms) => seek(row.id, ms)}
          compact
        />
      </div>

      {row.kind === "diary" && (
        <DiaryPage
          row={row}
          entries={view.diary.filter((e) => e.regions.some((r) => pageIds.has(r.sourceId)))}
          onNote={(c) => actions.diaryNote(main?.id ?? row.id, c)}
          onOpen={() => actions.openDiary(row.id)}
        />
      )}
      {row.kind === "diary" && <PageNumbering row={row} view={view} apply={actions.apply} />}

      {row.idle.length > 0 && (
        <Fold title={`Stille (${row.idle.length})`}>
          <ul className="font-mono text-[0.85rem]">
            {row.idle.map((i) => (
              <li key={i.startMs}>
                {clock(i.startMs)} – {clock(i.endMs)}
              </li>
            ))}
          </ul>
          {row.loudAtMs.length > 0 && (
            <p className="mt-1 text-[0.85rem] text-warn">
              Laut in der Stille: {row.loudAtMs.slice(0, 5).map(clock).join(", ")}
              {row.loudAtMs.length > 5 ? " …" : ""}
            </p>
          )}
        </Fold>
      )}

      <Eyebrow>Zeitbelege</Eyebrow>
      <EvidenceList row={row} actions={actions} />
      {row.status === "context" && row.evidence.length > 0 && (
        <p className="mt-1.5 text-[0.85rem] text-muted">Die Zeitbelege ruhen, solange das Stück Kontext ist.</p>
      )}
      {row.kind !== "diary" && !row.partOf && row.status !== "context" && (
        <TimeForm key={manualAsk} row={row} onAdd={actions.addTime} initialOpen={manualAsk > 0} />
      )}
      {row.partOf && (
        <p className="mt-1.5 text-[0.85rem] text-muted">Die Zeit kommt von {main?.label ?? "der Seite"}.</p>
      )}

      <Fold title="Datei">
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
            ["Zustand", FILE_STATE_TEXT[row.file]],
            [
              "Original",
              <span key="p" title={row.originalPath} className="block truncate text-left [direction:rtl]">
                {"\u200e"}
                {row.originalPath}
              </span>,
              "text-[0.82rem] text-ink-2",
            ],
          ]}
        />
      </Fold>
    </>
  );
}

/** Zweiter Weg bei „ohne Uhrzeit“: Karten, Listen und Zusammenfassungen gelten für den ganzen Tag. */
function NotInChronology({ diary, onContext }: { diary: boolean; onContext: () => void }) {
  return (
    <div className="mt-3.5 rounded-lg border border-line p-3 text-[0.86rem]" data-testid="not-in-chronology">
      <p>
        <b className="font-semibold">Gehört nicht in die Chronologie?</b>{" "}
        <span className="text-muted">Karten, Listen und Zusammenfassungen gelten für den ganzen Tag.</span>
      </p>
      <Button size="sm" className="mt-2" onClick={onContext}>
        {diary ? "Seite als Kontext führen" : "Als Kontext führen"}
      </Button>
    </div>
  );
}
