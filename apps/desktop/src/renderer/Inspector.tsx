import { formatDuration } from "@feldspur/core/time";
import type { ReactNode } from "react";
import { mediaUrl, type SessionView, type SourceRow } from "../shared/api.ts";
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
import { Fold, KV } from "./inspector/parts.tsx";
import { CheckPanel } from "./inspector/CheckPanel.tsx";
import { DiaryPage } from "./inspector/DiaryPage.tsx";
import { EvidenceList, TimeForm } from "./inspector/Evidence.tsx";
import { LevelPanel } from "./inspector/LevelPanel.tsx";
import { Player } from "./inspector/Player.tsx";
import { TranscriptImport, TranscriptSummary } from "./inspector/Transcript.tsx";

export function Inspector({
  view,
  row,
  step,
  onClose,
  onGo,
  actions,
}: {
  view: SessionView;
  row: SourceRow | null;
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
          <SourceDetails key={row.id} row={row} view={view} step={step} onClose={onClose} actions={actions} />
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
  onClose,
  actions,
}: {
  row: SourceRow;
  view: SessionView;
  step: Step;
  onClose: () => void;
  actions: InspectorActions;
}) {
  // In Durchsehen ist das Prüfen die Hauptsache: dann steht es oben, vor Player und Vorschau.
  const checkFirst = step === "review";
  const items: [string, ReactNode, string?][] = [
    [
      "Lage",
      <>
        <span className="whitespace-nowrap">{lage(row.startMs, row.endMs)}</span>
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
          <StatusDot status={row.status} />
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
      {checkFirst && <CheckPanel row={row} view={view} actions={actions} />}
      {(row.kind === "audio" || row.kind === "video") && (
        <>
          <Player row={row} />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button size="sm" onClick={() => sa.preview(row.id)}>
              Groß ansehen
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
            Groß ansehen
          </span>
        </button>
      )}
      <KV items={items} />
      {!checkFirst && <CheckPanel row={row} view={view} actions={actions} />}

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
      {row.kind !== "diary" && !row.partOf && <TimeForm row={row} onAdd={actions.addTime} />}
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
