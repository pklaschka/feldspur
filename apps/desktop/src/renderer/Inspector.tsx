import { formatDuration } from "@feldspur/core/time";
import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  mediaUrl,
  type DiaryEntryRow,
  type Precision,
  type SessionView,
  type SourceRow,
  type TimeInput,
} from "../shared/api.ts";
import { bytes, clock, EVIDENCE_LABEL, KIND_LABEL, lage, offsetText, STATUS_TEXT } from "./format.ts";
import { PdfPageCanvas } from "./pdf.tsx";
import { positionText, usePlayback } from "./playback.tsx";
import { SourceMenu, useActions } from "./SourceMenu.tsx";
import {
  Button,
  Choice,
  CloseButton,
  cx,
  Eyebrow,
  Glyph,
  Pill,
  PRECISION_OPTIONS,
  StatusDot,
  STATUS_TEXT_CLASS,
  Toggle,
} from "./ui.tsx";

export interface InspectorActions {
  diaryNote: (sourceId: string, clock: string) => void;
  addTime: (input: TimeInput) => Promise<boolean>;
  toggleEvidence: (evidenceId: string, enabled: boolean) => void;
  removeEvidence: (evidenceId: string) => void;
  openDiary: (pageId: string) => void;
  transcribe: (sourceId: string) => void;
  /** Gibt die Zahl übernommener Zeilen zurück, null bei Abbruch oder Fehler. */
  importTranscript: (sourceId: string, mode: "append" | "replace") => Promise<number | null>;
}

export function Inspector({
  view,
  row,
  onClose,
  actions,
}: {
  view: SessionView;
  row: SourceRow | null;
  onClose: () => void;
  actions: InspectorActions;
}) {
  return (
    <aside className="min-w-0 overflow-x-hidden overflow-y-auto border-l border-line bg-panel" data-testid="inspector">
      <div className="px-4.5 pt-4 pb-6">
        {row ? (
          <SourceDetails key={row.id} row={row} view={view} onClose={onClose} actions={actions} />
        ) : (
          <Summary view={view} />
        )}
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
  view,
  onClose,
  actions,
}: {
  row: SourceRow;
  view: SessionView;
  onClose: () => void;
  actions: InspectorActions;
}) {
  const items: [string, ReactNode, string?][] = [
    [
      "Lage",
      <>
        <span className="whitespace-nowrap">{lage(row.startMs, row.endMs)}</span>
        {row.uncertaintyMs !== null && row.uncertaintyMs > 0 && (
          <span className="block text-[0.8rem] text-muted">± {formatDuration(row.uncertaintyMs)}</span>
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
        {row.notes.length > 0 && <span className="block text-[0.8rem] text-muted">{row.notes.join(" · ")}</span>}
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
        <span className="-mt-1 -mr-1.5 flex">
          <SourceMenu row={row} view={view} />
          <CloseButton onClick={onClose} />
        </span>
      </div>
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
        </>
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
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[0.72rem] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            Groß ansehen
          </span>
        </button>
      )}
      <KV items={items} />

      {row.kind === "diary" && (
        <DiaryPage
          row={row}
          entries={view.diary.filter((e) => e.regions.some((r) => pageIds.has(r.sourceId)))}
          onNote={(c) => actions.diaryNote(main?.id ?? row.id, c)}
          onOpen={() => actions.openDiary(row.id)}
        />
      )}

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
      <EvidenceList row={row} actions={actions} />
      {row.kind !== "diary" && !row.partOf && <TimeForm row={row} onAdd={actions.addTime} />}
      {row.partOf && (
        <p className="mt-1.5 text-[0.8rem] text-muted">Die Zeit kommt von {main?.label ?? "der Seite"}.</p>
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
            <span key="p" title={row.originalPath} className="block truncate text-left [direction:rtl]">
              {"\u200e"}
              {row.originalPath}
            </span>,
            "text-[0.78rem] text-ink-2",
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

function EvidenceList({ row, actions }: { row: SourceRow; actions: InspectorActions }) {
  if (!row.evidence.length) {
    return (
      <p className="text-[0.8rem] text-muted">
        {row.kind === "diary" && row.diaryNote
          ? "Zeit aus der Randnotiz."
          : "Keine Zeit in Metadaten oder Dateiname gefunden."}
      </p>
    );
  }
  return (
    <ul className="grid gap-1.5" data-testid="evidence-list">
      {row.evidence.map((e) => (
        <li
          key={e.id}
          className={cx(
            "grid grid-cols-[1fr_auto] items-center gap-x-2 rounded-[7px] border border-l-[3px] px-2.5 py-1.5",
            e.chosen ? "border-line border-l-accent bg-panel-2" : "border-line",
          )}
        >
          <span className="text-[0.72rem] font-semibold tracking-[0.04em] text-muted uppercase">
            {EVIDENCE_LABEL[e.kind] ?? e.kind}
            {e.chosen && (
              <span className="ml-1.5 normal-case">
                <Pill tone="accent">verwendet</Pill>
              </span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {e.own && (
              <Button variant="link" className="text-[0.75rem]" onClick={() => actions.removeEvidence(e.id)}>
                löschen
              </Button>
            )}
            {!e.derived && (
              <Toggle
                checked={e.enabled}
                onChange={(v) => actions.toggleEvidence(e.id, v)}
                label={`${e.detail} ${e.enabled ? "abschalten" : "einschalten"}`}
              />
            )}
          </span>
          <span className={cx("col-span-2 [overflow-wrap:anywhere]", !e.enabled && "text-muted line-through")}>
            {e.detail}
          </span>
          {e.raw && (
            <span className="col-span-2 font-mono text-[0.8rem] [overflow-wrap:anywhere] text-muted">{e.raw}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Uhrzeit von Hand eintragen oder angesagte Uhrzeit markieren. */
function TimeForm({ row, onAdd }: { row: SourceRow; onAdd: (input: TimeInput) => Promise<boolean> }) {
  const av = row.kind === "audio" || row.kind === "video";
  const { position } = usePlayback();
  const here = position?.sourceId === row.id ? position.atMs : null;
  const [open, setOpen] = useState(row.status === "unplaced");
  const [kind, setKind] = useState<"manual" | "spoken">("manual");
  const [time, setTime] = useState("");
  const [at, setAt] = useState("");
  const [precision, setPrecision] = useState<Precision>(row.status === "unplaced" && !av ? "approx" : "exact");
  const [note, setNote] = useState("");
  const [syncDevice, setSyncDevice] = useState(false);
  const canSync = kind === "manual" && !!row.deviceId && row.hasDeviceClock;
  if (!open) {
    return (
      <Button variant="link" className="mt-2 text-[0.8rem]" onClick={() => setOpen(true)}>
        + Uhrzeit eintragen{av ? " oder Ansage markieren" : ""}
      </Button>
    );
  }
  const submit = async () => {
    const ok = await onAdd({
      sourceId: row.id,
      kind,
      clock: time,
      atMedia: av ? at : "",
      precision,
      note,
      syncDevice: canSync && syncDevice,
    });
    if (ok) {
      setSyncDevice(false);
      setTime("");
      setAt("");
      setNote("");
      setOpen(false);
    }
  };
  return (
    <form
      className="mt-2.5 grid gap-2 rounded-lg border border-line bg-panel-2 p-3"
      data-testid="time-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {av && (
        <Choice
          label="Art der Zeitangabe"
          value={kind}
          onChange={setKind}
          options={[
            { value: "manual", label: "Von Hand" },
            { value: "spoken", label: "Angesagt" },
          ]}
        />
      )}
      <div className="grid gap-2 text-[0.85rem]">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-0.5">
            <span className="text-muted">Uhrzeit</span>
            <input
              className="w-24 font-mono"
              placeholder="hh:mm:ss"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Uhrzeit"
            />
          </label>
          {av && (
            <label className="grid gap-0.5">
              <span className="text-muted">an Stelle</span>
              <input
                className="w-24 font-mono"
                placeholder="m:ss"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                aria-label="Stelle in der Aufnahme"
              />
            </label>
          )}
        </div>
        {av && here !== null && (
          <Button
            variant="link"
            type="button"
            className="justify-self-start text-[0.75rem]"
            onClick={() => setAt(positionText(here))}
          >
            ↳ Wiedergabestelle {positionText(here)} übernehmen
          </Button>
        )}
        <div className="grid gap-0.5">
          <span className="text-muted">Genauigkeit</span>
          <Choice label="Genauigkeit" value={precision} onChange={setPrecision} options={PRECISION_OPTIONS} />
        </div>
        <input
          className="w-full min-w-0"
          placeholder="Notiz (optional), z. B. „Kirchturmuhr“"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Notiz"
        />
      </div>
      {canSync && (
        <label className="flex items-start gap-2 text-[0.85rem]">
          <input
            type="checkbox"
            className="mt-1"
            checked={syncDevice}
            onChange={(e) => setSyncDevice(e.target.checked)}
            aria-label={`Uhr von ${row.deviceLabel} danach richten`}
          />
          <span>
            Uhr von „{row.deviceLabel}“ danach richten
            <span className="block text-[0.75rem] text-muted">
              Aus dieser Angabe wird die Abweichung der Geräteuhr berechnet. Alle anderen Dateien des Geräts rücken mit.
            </span>
          </span>
        </label>
      )}
      <p className="text-[0.75rem] text-muted">
        {kind === "spoken"
          ? "Die angesagte Zeit gleicht die Uhr des ganzen Geräts ab, sofern die Aufnahme auch eine Zeit der Geräteuhr hat."
          : "Gilt nur für diese Quelle und hat Vorrang vor gelesenen Zeiten."}
      </p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" type="submit" disabled={!time.trim()}>
          Eintragen
        </Button>
        <Button size="sm" type="button" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

/** Audio/Video abspielen; meldet die Stelle an die Zeitachse und nimmt Spul-Wünsche an. */
function Player({ row }: { row: SourceRow }) {
  const { report, seekRequest, position } = usePlayback();
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const raf = useRef(0);

  const send = () => {
    const el = ref.current;
    if (el) report({ sourceId: row.id, atMs: Math.round(el.currentTime * 1000), playing: !el.paused });
  };
  // Während der Wiedergabe flüssig nachführen, nicht nur bei timeupdate (≈ 4 Hz).
  const loop = () => {
    send();
    if (ref.current && !ref.current.paused) raf.current = requestAnimationFrame(loop);
  };
  useEffect(() => {
    const el = ref.current;
    if (el && seekRequest?.sourceId === row.id) {
      el.currentTime = seekRequest.atMs / 1000;
      send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest, row.id]);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      report(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [row.id],
  );

  const here = position?.sourceId === row.id ? position.atMs : null;
  const props = {
    ref,
    src: mediaUrl(row.id),
    controls: true,
    preload: "metadata",
    onLoadedMetadata: () => {
      if (seekRequest?.sourceId === row.id && ref.current) ref.current.currentTime = seekRequest.atMs / 1000;
      send();
    },
    onSeeked: send,
    onPlay: () => {
      raf.current = requestAnimationFrame(loop);
    },
    onPause: send,
    onError: () => setFailed(true),
    "data-testid": "player",
  } as const;
  return (
    <div className="mt-3.5">
      {failed ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[0.8rem] text-warn">
          Diese Datei lässt sich hier nicht abspielen (Format oder Codec). Für die Wiedergabe kommen später
          Vorschau-Kopien.
        </p>
      ) : row.kind === "video" ? (
        <video {...props} className="block max-h-56 w-full rounded-lg bg-black" />
      ) : (
        <audio {...props} className="block w-full" />
      )}
      {here !== null && (
        <div className="mt-1 flex justify-between font-mono text-[0.78rem] text-ink-2" data-testid="player-position">
          <span>{positionText(here)}</span>
          {row.startMs !== null && <span>{clock(row.startMs + here)}</span>}
        </div>
      )}
    </div>
  );
}

/** Tagebuchseite in der Detailleiste: Einträge im Überblick, schnelle Randnotiz bei höchstens einem Eintrag. */
function DiaryPage({
  row,
  entries,
  onNote,
  onOpen,
}: {
  row: SourceRow;
  entries: DiaryEntryRow[];
  onNote: (clock: string) => void;
  onOpen: () => void;
}) {
  return (
    <>
      {entries.length <= 1 && <DiaryNote row={row} onCommit={onNote} />}
      <Eyebrow>Einträge auf dieser Seite</Eyebrow>
      {entries.length > 0 ? (
        <ul className="grid gap-1 text-[0.85rem]">
          {entries.map((e) => (
            <li key={e.id} className="flex gap-2">
              <b className="font-mono text-k-diary">{e.number}</b>
              <span className="font-mono text-muted">{e.notedAt ?? "–:–"}</span>
              <span className="truncate">
                {e.shortText || (e.mode === "scan" ? "nur Scan" : "noch nicht abgetippt")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.8rem] text-muted">Noch nicht abgetippt.</p>
      )}
      <Button variant="primary" size="sm" className="mt-2" onClick={onOpen}>
        Abtippen…
      </Button>
    </>
  );
}

/** Fertiges Transkript (Whisper u. a.) übernehmen; gibt es schon Zeilen, ergänzen oder ersetzen. */
function TranscriptImport({
  view,
  row,
  onImport,
}: {
  view: SessionView;
  row: SourceRow;
  onImport: InspectorActions["importTranscript"];
}) {
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => setDone(null), [row.id]);
  const has = view.transcript.some((l) => l.sourceId === row.id);
  const run = async (mode: "append" | "replace") => {
    const n = await onImport(row.id, mode);
    if (n !== null) setDone(`${n} ${n === 1 ? "Zeile" : "Zeilen"} übernommen`);
  };
  const trigger = "Transkript importieren…";
  return (
    <>
      {done && (
        <span className="self-center text-[0.75rem] text-good" role="status">
          {done}
        </span>
      )}
      {has ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm">{trigger}</Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-56 rounded-lg border border-line bg-panel p-1 shadow-lg"
            >
              {(
                [
                  ["append", "Zur Mitschrift hinzufügen …"],
                  ["replace", "Mitschrift ersetzen …"],
                ] as const
              ).map(([mode, label]) => (
                <DropdownMenu.Item
                  key={mode}
                  className="cursor-pointer rounded px-2.5 py-1.5 text-[0.85rem] outline-none data-[highlighted]:bg-accent-soft"
                  onSelect={() => void run(mode)}
                >
                  {label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : (
        <Button size="sm" onClick={() => void run("append")} title="SRT, VTT, JSON oder TSV, z. B. aus Whisper">
          {trigger}
        </Button>
      )}
    </>
  );
}

function TranscriptSummary({ view, row }: { view: SessionView; row: SourceRow }) {
  const lines = view.transcript.filter((l) => l.sourceId === row.id);
  if (!lines.length) return null;
  const last = lines.at(-1)!;
  return (
    <p className="mt-1.5 text-[0.8rem] text-muted" data-testid="transcript-summary">
      Mitschrift: {lines.length} {lines.length === 1 ? "Zeile" : "Zeilen"}, bis {positionText(last.atMs)}
    </p>
  );
}
