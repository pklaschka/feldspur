/**
 * Schritt „Ausgeben“: ein Ordner pro Einsatz mit Montagevideo, Einsatztranskript (.docx), Dokumentvariablen und
 * Begleitprotokoll.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExportCard,
  ExportProgress,
  ExportStatus,
  OriginalsCheck,
  SessionTranscriptPreview,
  SessionView,
} from "../shared/api.ts";
import { CHECK_STEP, cancelledText, percent, remainingMs, remainingText, useExport } from "./exportState.tsx";
import { formatDuration } from "@feldspur/core/time";
import { aboutSize, someLabels } from "./format.ts";
import { MontageView } from "./MontageView.tsx";
import { SessionTranscriptLine } from "./SessionTranscriptLine.tsx";
import { todos, type Todo } from "./inspector/status.ts";
import { TodoList } from "./inspector/Summary.tsx";
import { FILE_STATE_TEXT } from "./Originals.tsx";
import { Button, ContextMark, cx, FlagMark, Notice, Panel, StepHeader, Toggle } from "./ui.tsx";

const api = window.feldspur;

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
/** Übergeordneter Ordner eines Pfads (Windows oder sonst). */
const parentDir = (p: string) => p.replace(/[\\/][^\\/]*[\\/]?$/, "") || p;
const FILE_ROLE: [RegExp, string][] = [
  [/\.mp4$/, "Montagevideo zum Zuordnen: Uhrzeit, Videos und Ton mit Herkunft, Montage-ID"],
  [/^LIESMICH\.html$/, "LIESMICH: was im Ordner liegt, wie zitiert wird, Tabelle für den Methodenteil"],
  [/^manifest-sha256\.txt$/, "Prüfsummenliste: SHA-256 jeder Datei im Ordner"],
  [/_Aenderungsprotokoll\.csv$/, "Änderungsprotokoll dieses Einsatzes: jede Änderung mit vorher und nachher"],
  [/\.html$/, "Viewer: Einsatztranskript synchron zum Video, im Browser öffnen"],
  [/\.docx$/, "Einsatztranskript für MAXQDA, mit Zeitmarken zum Video, Mitschrift und Bildern"],
  [/\.xlsx$/, "Dokumentvariablen für MAXQDA (Variablen › Dokumentvariablen importieren)"],
  [/\.csv$/, "Begleitprotokoll: Herkunft und Zeitnachweis jeder Datei"],
  [/\.fcpxml$/, "Schnittliste für DaVinci Resolve (Datei › Importieren › Timeline)"],
];

/** Ausgabe-Einstellungen gelten für alle Einsätze und bleiben bis zur nächsten Sitzung erhalten. */
interface Options {
  video: boolean;
  resolve: boolean;
  mixAudio: boolean;
  deviceTracks: boolean;
  viewer: boolean;
  readme: boolean;
  changeLog: boolean;
  manifest: boolean;
  byEpisodes: boolean;
}
const DEFAULTS: Options = {
  video: true,
  resolve: false,
  mixAudio: true,
  deviceTracks: true,
  viewer: true,
  readme: true,
  changeLog: true,
  manifest: true,
  byEpisodes: false,
};
const KEY = "feldspur.export-options";
function loadOptions(): Options {
  try {
    const o = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Options>) };
    // Früher ließ sich der Viewer ohne Video wählen (und fiel dann still weg); jetzt hält er das Video fest.
    return o.viewer && !o.video ? { ...o, viewer: false } : o;
  } catch {
    return DEFAULTS;
  }
}

/** Pfad einer Datei im Ausgabeordner, mit dem Trenner, den der Ordner schon hat (Windows oder sonst). */
const inDir = (dir: string, name: string) => `${dir}${dir.includes("\\") ? "\\" : "/"}${name}`;
const GB = 1024 ** 3;
/** „12,4 von 80,0 GB geprüft“; unter einem GB in MB. */
function checkedText(p: ExportProgress): string {
  const big = p.total >= GB;
  const unit = big ? GB : 1024 ** 2;
  const n = (x: number) => (x / unit).toFixed(big ? 1 : 0).replace(".", ",");
  return `${n(p.done)} von ${n(p.total)} ${big ? "GB" : "MB"} geprüft`;
}
const files = (n: number) => `${n} ${n === 1 ? "Datei" : "Dateien"}`;
/** „2026-09-14“ → „14.09.2026“. */
const germanDate = (iso: string) => iso.split("-").reverse().join(".");
const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

export function ExportStep({
  view,
  onGo,
  onView,
  onOriginals,
}: {
  view: SessionView;
  onGo: (t: Todo) => void;
  onView: (v: SessionView) => void;
  onOriginals: () => void;
}) {
  const [preview, setPreview] = useState<SessionTranscriptPreview | null>(null);
  const [opts, setOpts] = useState(loadOptions);
  const set = (patch: Partial<Options>) =>
    setOpts((o) => {
      const next = { ...o, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // ohne Speicher gelten die Einstellungen nur bis zum Neustart
      }
      return next;
    });
  const { video, resolve, mixAudio, deviceTracks, viewer, readme, changeLog, manifest, byEpisodes } = opts;
  const [watching, setWatching] = useState(false);
  const withEpisodes = view.session.episodes;
  const realtime = !(withEpisodes && byEpisodes);
  const ex = useExport();
  const sessionId = view.session.id;
  const busy = ex.job?.sessionId === sessionId;
  const elsewhere = !!ex.job && !busy;
  const progress = busy ? ex.job!.progress : null;
  const justDone = busy ? null : (ex.results[sessionId] ?? null);
  const error = busy ? null : (ex.errors[sessionId] ?? null);
  const cancelled = busy ? null : (ex.cancelled[sessionId] ?? null);
  const settings = useMemo(
    () => ({ video, resolve, mixAudio, deviceTracks, viewer, readme, changeLog, manifest, realtime }),
    [video, resolve, mixAudio, deviceTracks, viewer, readme, changeLog, manifest, realtime],
  );
  // Stand der letzten Ausgabe steht in der Projektdatei und übersteht so auch einen Neustart.
  const [status, setStatus] = useState<ExportStatus | null>(null);
  useEffect(() => {
    if (busy) return;
    let live = true;
    void api.exportStatus(sessionId, settings).then(
      (st) => live && setStatus(st),
      () => live && setStatus(null),
    );
    return () => {
      live = false;
    };
  }, [view, sessionId, settings, busy, justDone]);
  const result = busy || status?.record.sessionId !== sessionId ? null : status;

  useEffect(() => {
    let live = true;
    void api.previewExport(sessionId, realtime).then(
      (p) => live && setPreview(p),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [view, sessionId, realtime]);
  // Hat die Prüfung der Originale (erster Schritt der Ausgabe) etwas gefunden, hält die Ausgabe an. Das Ergebnis
  // gilt nur für die Einstellung (mit/ohne Video) und die Pfade, mit denen geprüft wurde.
  const held = busy ? null : (ex.held[sessionId] ?? null);
  const paths = view.rows.map((r) => r.originalPath).join("\n");
  const found = held && held.opts.video === video && held.key === paths ? held : null;
  // Nach der Prüfung kennt die App die Prüfsummen: Zustand der Originale in der Ansicht auffrischen.
  const checkedJob = useRef(false);
  useEffect(() => {
    if (busy) {
      checkedJob.current = true;
      return;
    }
    if (!checkedJob.current) return;
    checkedJob.current = false;
    void api.getSession(sessionId).then(onView, () => {});
  }, [busy, sessionId, onView]);
  /** Ausgeben: erst Ordner wählen, dann prüft die Ausgabe als ersten Schritt die Originale (Issue #116). */
  const run = (reuse = false) => {
    ex.start(sessionId, { ...settings, reuseDir: reuse }, paths);
  };
  /** Nach der Prüfung bewusst weiter: gleiche Einstellungen, schon gewählter Ordner. */
  const proceed = () => {
    if (!found) return;
    ex.start(sessionId, { ...found.opts, reuseDir: false, dir: found.parent, acceptOriginals: true }, paths);
  };
  const stale = !!result && result.differences.length > 0;
  // Zahlen für die Beleg-Karte, nur für eine aktuelle Ausgabe (dann gleichen sie denen der Ausgabe).
  const [loadedCard, setCard] = useState<{ key: string; card: ExportCard } | null>(null);
  const cardFor = result && !stale ? `${sessionId}\n${result.record.exportedAt}` : null;
  useEffect(() => {
    if (!cardFor) return;
    let live = true;
    void api.exportCard(sessionId, settings).then(
      (c) => live && setCard({ key: cardFor, card: c }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [view, cardFor, sessionId, settings]);
  const card = loadedCard && loadedCard.key === cardFor ? loadedCard.card : null;

  const empty = !preview || preview.durationMs <= 0;
  const pct = percent(progress, ex.job?.video);
  const open = todos(view);

  return (
    <>
      <StepHeader
        className="max-w-[1240px]"
        title="Ausgeben"
        summary="Ein Ordner pro Einsatz. Immer dabei sind Einsatztranskript für MAXQDA, Dokumentvariablen und Begleitprotokoll; was dazukommt, wählst du unten."
        help={
          <>
            <p className="mb-1.5">
              In MAXQDA das Einsatztranskript (.docx) als Transkript importieren und das Montagevideo als Mediendatei
              zuordnen. Die Zeitmarken <code>#hh:mm:ss-z#</code> zeigen auf Stellen im Video; die echte Uhrzeit steht in
              jeder Zeile dahinter.
            </p>
            <p className="mb-1.5">
              Das Video zeigt nur, was zum Zuordnen nötig ist: Uhrzeit, die laufenden Videos (gleichzeitige
              nebeneinander) mit Datei und Stelle im Original, die laufenden Tonquellen und eine Montage-ID, die auch im
              Kopf des Einsatztranskripts steht. Fotos und Tagebuch stehen im Einsatztranskript.
            </p>
            <p>
              Standard ist Echtzeit: Der ganze Einsatz läuft am Stück, Videozeit = Uhrzeit ab Beginn. Wer unter
              „Durchsehen“ Episoden einschaltet, kann stattdessen nach Episoden schneiden: Episoden laufen in voller
              Länge, Zeit dazwischen wird zu einer kurzen Tafel. Weitertippen kannst du in MAXQDA an jeder Stelle, weil
              jede Zeile schon eine Zeitmarke hat.
            </p>
          </>
        }
      />
      {result && !stale && !busy && !error && !cancelled ? (
        // Die Beleg-Karte ist selbst die Karte: kein Rahmen um den Rahmen.
        <div className="mb-5 max-w-[1240px] pr-1.5">
          <ExportResult
            status={result}
            card={card}
            fresh={!!justDone}
            disabled={!!found}
            onRerun={() => run(true)}
            onRerunElsewhere={() => run()}
          />
        </div>
      ) : (
        (busy || result || error || cancelled) && (
          <Panel className="mb-4 max-w-[1240px]">
            {busy && (
              <div data-testid="export-progress">
                <div className="mb-1 flex items-center gap-3 text-[0.9rem]">
                  <span>{ex.job!.cancelling ? "Bricht ab…" : (progress?.step ?? "Vorbereiten")}</span>
                  <span className="flex-1" />
                  <span className="text-muted tabular-nums">
                    {progress?.step === "Montagevideo" &&
                      !ex.job!.cancelling &&
                      `${remainingText(remainingMs(ex.job))} · `}
                    {progress?.step === CHECK_STEP && !ex.job!.cancelling && `${checkedText(progress)} · `}
                    {pct} %
                  </span>
                  <Button size="sm" disabled={ex.job!.cancelling} onClick={ex.cancel} data-testid="export-cancel">
                    Abbrechen
                  </Button>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-sunken"
                  role="progressbar"
                  aria-label="Ausgabe"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-valuetext={`${progress?.step ?? "Vorbereiten"}, ${pct} %`}
                >
                  <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-[0.85rem] text-muted">
                  {progress?.step === CHECK_STEP || !progress
                    ? "Zuerst prüft Feldspur, ob die Originale noch dieselben sind wie beim Einsammeln (schon geprüfte merkt es sich). "
                    : ""}
                  Du kannst weiterarbeiten oder den Schritt wechseln, die Ausgabe läuft weiter. Änderungen ab jetzt
                  kommen in die nächste Ausgabe.
                </p>
              </div>
            )}
            {error && <Notice>Ausgabe fehlgeschlagen: {error}</Notice>}
            {cancelled && (
              <p className="text-[0.9rem]" role="status" data-testid="export-cancelled">
                {cancelledText(cancelled)}
              </p>
            )}
            {result && (
              <ExportResult
                status={result}
                card={card}
                fresh={!!justDone && !stale}
                disabled={!!ex.job || !!found}
                onRerun={() => run(true)}
                onRerunElsewhere={() => run()}
              />
            )}
          </Panel>
        )
      )}
      {/* Nebeneinander, sobald die Mitte breit genug ist (Containerbreite, nicht Fenster): so bleibt die Vorschau lesbar. */}
      <div className="@container max-w-[1240px]">
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Panel>
            <p className="font-serif text-[1.1rem] leading-snug" data-testid="export-summary">
              {!preview ? (
                "Die Montage wird berechnet…"
              ) : (
                <>
                  Das Montagevideo wird <b className="font-semibold">{formatDuration(preview.durationMs)}</b> lang
                  {withEpisodes ? (
                    <>
                      , mit <b className="font-semibold">{preview.episodes}</b>{" "}
                      {preview.episodes === 1 ? "Episode" : "Episoden"} und{" "}
                      <b className="font-semibold">{preview.cards}</b> {realtime ? "Zwischenzeiten" : "Zwischentafeln"}.
                    </>
                  ) : (
                    realtime && ", der ganze Einsatz in Echtzeit."
                  )}
                </>
              )}
              <Button
                variant="link"
                className="ml-2 font-sans text-[0.9rem]"
                disabled={empty}
                onClick={() => setWatching(true)}
              >
                Montage ansehen…
              </Button>
            </p>
            <MontageView
              sessionId={sessionId}
              realtime={realtime}
              open={watching}
              onOpenChange={setWatching}
              levels={new Map(view.rows.map((r) => [r.id, r.level]))}
            />
            <OptionGroup title="Montagevideo">
              <Option
                checked={video}
                onChange={(v) => set({ video: v })}
                disabled={viewer}
                label="Montagevideo mit ausgeben"
                size={
                  preview && !empty
                    ? aboutSize(preview.videoBytes.video + (deviceTracks ? preview.videoBytes.deviceTracks : 0))
                    : undefined
                }
                hint={
                  viewer
                    ? "Bleibt an, weil der Viewer dieses Video abspielt. Zum Ausschalten zuerst den Viewer abwählen."
                    : "Dauert einige Minuten. Aus: nur Einsatztranskript, Dokumentvariablen und Begleitprotokoll."
                }
              />
              {withEpisodes && (
                <Option
                  checked={byEpisodes}
                  onChange={(v) => set({ byEpisodes: v })}
                  label="Nach Episoden schneiden"
                  hint="Kürzer, aber Videozeit ≠ Uhrzeit. Aus: der ganze Einsatz in Echtzeit."
                />
              )}
              {!withEpisodes && (
                <p className="pl-[2.625rem] text-[0.85rem] text-muted">
                  Nach Episoden schneiden geht, wenn unter „Durchsehen“ Episoden eingeschaltet sind.
                </p>
              )}
              <Option
                checked={mixAudio}
                onChange={(v) => set({ mixAudio: v })}
                label="Ton aller Geräte mischen"
                hint="Aus: nur der Ton der Hauptquelle."
              />
              <Option
                checked={deviceTracks}
                onChange={(v) => set({ deviceTracks: v })}
                label="Zusätzlich eine Tonspur je Gerät"
                hint="Die Mischung bleibt Spur 1. VLC und Schnittprogramme spielen die Geräte auch einzeln."
              />
              <Option
                checked={viewer}
                onChange={(v) => set(v ? { viewer: true, video: true } : { viewer: false })}
                label="Viewer zum Ansehen im Browser (.html)"
                hint="Eine Datei neben dem Video: Das Einsatztranskript läuft mit, ein Klick auf eine Zeile springt dorthin. Enthält die Bilder und schaltet das Montagevideo mit ein."
              />
            </OptionGroup>
            <OptionGroup title="Nachweise im Ordner">
              <Option
                checked={readme}
                onChange={(v) => set({ readme: v })}
                label="LIESMICH mit Tabelle für den Methodenteil (.html)"
                hint="Erklärt, was im Ordner liegt und wie daraus zitiert wird; nennt Eingang, Ausgabe und Montage-ID."
              />
              <Option
                checked={changeLog}
                onChange={(v) => set({ changeLog: v })}
                label="Änderungsprotokoll (.csv)"
                hint="Jede Änderung an diesem Einsatz mit Zeit und den Werten vorher und nachher."
              />
              <Option
                checked={manifest}
                onChange={(v) => set({ manifest: v })}
                label="Prüfsummenliste (manifest-sha256.txt)"
                hint="SHA-256 jeder Datei im Ordner. Damit lässt sich später zeigen, dass nichts verändert wurde."
              />
            </OptionGroup>
            <OptionGroup title="Für den Schnitt">
              <Option
                checked={resolve}
                onChange={(v) => set({ resolve: v })}
                label="Schnittliste für DaVinci Resolve"
                hint="Dieselbe Montage als FCPXML, ohne Einblendungen."
              />
            </OptionGroup>
            {view.context.length > 0 && <ContextCard view={view} onView={onView} />}
            {open.length > 0 && !empty && (
              <section className="mt-5 border-t border-line pt-3 text-[0.9rem]" data-testid="export-open">
                <b className="block font-semibold text-warn">Noch offen</b>
                <p className="mb-1.5 text-[0.85rem]">
                  Ausgeben geht trotzdem; was offen ist, steht dann so im Einsatztranskript, wie es gerade liegt.
                </p>
                <TodoList items={open} onGo={onGo} />
              </section>
            )}
            {found && (
              <PreCheckResult
                view={view}
                result={found.result}
                parent={found.parent}
                onOriginals={onOriginals}
                onContinue={proceed}
                onCancel={() => ex.dismiss(sessionId)}
              />
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={!!ex.job || empty || !!found} onClick={() => run()}>
                {busy ? "Gibt aus…" : open.length ? "Trotzdem ausgeben…" : "Ausgeben…"}
              </Button>
              {empty && <span className="text-[0.9rem] text-muted">Noch keine Quelle mit Uhrzeit.</span>}
              {elsewhere && (
                <span className="text-[0.9rem] text-muted">Ein anderer Einsatz wird gerade ausgegeben.</span>
              )}
            </div>
          </Panel>
          <Panel className="min-w-0">
            <h3 className="mb-2 text-[1rem] font-semibold">Vorschau des Einsatztranskripts</h3>
            <ol
              className="max-h-[calc(100vh-16rem)] overflow-y-auto font-serif text-[0.92rem] leading-relaxed text-ink-2"
              data-testid="session-transcript-preview"
            >
              {!!preview?.context.length && (
                <>
                  <li className="pb-1 font-sans font-semibold text-ink">Kontext</li>
                  <li className="pb-1 text-[0.85rem] italic">
                    Diese Stücke gehören nicht in die Chronologie und haben keine Zeitmarke.
                  </li>
                  {preview.context.map((c) => (
                    <li key={c.key} className="border-b border-line/60 py-1 break-words" data-kind="context">
                      <span className="font-semibold text-st-episode">{c.head}</span>
                      <span className="text-st-clock">{c.details}</span>
                      {c.body && <span className="block whitespace-pre-line">{c.body}</span>}
                    </li>
                  ))}
                  <li className="pt-3 pb-1 font-sans font-semibold text-ink">Chronologie</li>
                </>
              )}
              {preview?.entries.map((e, i) => (
                <SessionTranscriptLine key={i} entry={e} />
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * Letzte Ausgabe: wann, wohin, welche Dateien, und ob sie noch zum Einsatz passt. Passt sie nicht, steht dabei,
 * was sich geändert hat, damit niemand eine veraltete Fassung in MAXQDA weiterverwendet.
 */
/** „Erneut ausgeben“ geht in den bisherigen Ordner; der zweite Knopf fragt nach einem anderen. */
function RerunButtons({
  disabled,
  dir,
  onRerun,
  onRerunElsewhere,
}: {
  disabled: boolean;
  dir: string;
  onRerun: () => void;
  onRerunElsewhere: () => void;
}) {
  return (
    <>
      <Button size="sm" disabled={disabled} onClick={onRerun} title={`Ausgeben nach: ${parentDir(dir)}`}>
        Erneut ausgeben
      </Button>
      <Button size="sm" disabled={disabled} onClick={onRerunElsewhere}>
        In anderen Ordner ausgeben…
      </Button>
    </>
  );
}

function ExportResult({
  status,
  card,
  fresh,
  disabled,
  onRerun,
  onRerunElsewhere,
}: {
  status: ExportStatus;
  /** Zahlen für die Beleg-Karte; null, solange sie lädt oder wenn die Ausgabe veraltet ist. */
  card: ExportCard | null;
  fresh: boolean;
  disabled: boolean;
  onRerun: () => void;
  onRerunElsewhere: () => void;
}) {
  const { record, differences, missingFiles } = status;
  const stale = differences.length > 0;
  const gone = new Set(missingFiles);
  const present = record.files.find((f) => !gone.has(f));
  // Der Viewer ist die .html, die nicht die LIESMICH ist; nur anbieten, wenn er noch im Ordner liegt.
  const viewerFile = record.files.find((f) => f.endsWith(".html") && !/^LIESMICH\.html$/.test(f) && !gone.has(f));
  const [listOpen, setListOpen] = useState(false);
  const showFolder = () => void api.showInFolder(present ? inDir(record.dir, present) : record.dir);
  // Liegt keine der Dateien mehr dort, ist meist der ganze Ordner verschoben: ein Satz statt lauter Streichungen.
  const allGone = record.files.length > 0 && missingFiles.length === record.files.length;
  const fileList = allGone ? (
    <p className="mt-3 text-[0.9rem]" id={`export-files-${record.sessionId}`} data-testid="export-files">
      <span className="font-medium text-bad">
        Feldspur findet {record.files.length === 1 ? "die Datei" : `keine der ${files(record.files.length)}`} mehr im
        Ordner.
      </span>{" "}
      <span className="text-muted">
        Vermutlich wurde der Ordner „{fileName(record.dir)}“ verschoben, umbenannt oder gelöscht.
      </span>
    </p>
  ) : (
    <ul className="mt-3 grid gap-1.5" id={`export-files-${record.sessionId}`} data-testid="export-files">
      {record.files.map((f) => (
        <li key={f} className="text-[0.9rem]">
          <span className={`font-medium break-all ${gone.has(f) ? "text-muted line-through" : ""}`}>{f}</span>
          {gone.has(f) && <span className="ml-2 text-[0.85rem] text-bad">fehlt im Ordner</span>}
          <span className="block text-[0.85rem] text-muted">{FILE_ROLE.find(([re]) => re.test(f))?.[1] ?? ""}</span>
        </li>
      ))}
    </ul>
  );
  const missingNotice = missingFiles.length > 0 && (
    <div className="mt-3 rounded-lg bg-warn/8 px-3 py-2.5" role="status" data-testid="export-incomplete">
      <b className="block text-[0.9rem] font-semibold text-warn">
        {missingFiles.length === 1
          ? "Eine Datei fehlt im Ausgabeordner"
          : `${missingFiles.length} Dateien fehlen im Ausgabeordner`}
      </b>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <RerunButtons disabled={disabled} dir={record.dir} onRerun={onRerun} onRerunElsewhere={onRerunElsewhere} />
        <span className="text-[0.85rem] text-muted">Verschoben oder gelöscht? Das legt sie wieder an.</span>
      </div>
    </div>
  );

  if (!stale)
    return (
      <div data-testid="export-result" data-state="current">
        <ExportReceipt
          record={record}
          card={card}
          fresh={fresh}
          viewerFile={viewerFile}
          filesOpen={listOpen || missingFiles.length > 0}
          onToggleFiles={() => setListOpen((o) => !o)}
          onShowFolder={showFolder}
        >
          {missingNotice}
          {(listOpen || missingFiles.length > 0) && fileList}
          {!missingFiles.length && (
            <p className="mt-3 border-t border-line pt-2.5 text-[0.85rem] text-muted">
              Änderst du danach noch etwas, steht hier „Veraltet“, auch nach einem Neustart. Erneut ausgeben rechnet nur
              Geändertes neu.
            </p>
          )}
        </ExportReceipt>
      </div>
    );

  return (
    <div data-testid="export-result" data-state="stale">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[1.1rem] leading-snug">
            <span className="text-warn">Veraltet.</span> {allGone ? "Die Ausgabe lag" : files(record.files.length)} im
            Ordner „{fileName(record.dir)}“
          </p>
          <p className="text-[0.85rem] text-muted">Ausgegeben am {when(record.exportedAt)}</p>
        </div>
        {!allGone && (
          <Button size="sm" className="shrink-0" onClick={showFolder}>
            Im Ordner zeigen
          </Button>
        )}
      </div>
      <div className="mt-3 rounded-lg bg-warn/8 px-3 py-2.5" role="status" data-testid="export-stale">
        <b className="block text-[0.9rem] font-semibold text-warn">Passt nicht mehr zum Einsatz</b>
        <ul className="mt-1 grid list-disc gap-0.5 pl-5 text-[0.88rem]" data-testid="export-differences">
          {differences.map((d) => (
            <li key={d.kind}>
              {d.text}
              {d.labels?.length ? (
                <span className="ml-1.5 font-mono text-[0.82rem] text-muted" title={d.labels.join(", ")}>
                  {someLabels(d.labels)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <RerunButtons disabled={disabled} dir={record.dir} onRerun={onRerun} onRerunElsewhere={onRerunElsewhere} />
          <span className="text-[0.85rem] text-muted">Nur Geändertes wird neu gerechnet.</span>
        </div>
      </div>
      {missingFiles.length > 0 ? (
        fileList
      ) : (
        <>
          <Button
            variant="link"
            className="mt-3 text-[0.9rem]"
            aria-expanded={listOpen}
            aria-controls={`export-files-${record.sessionId}`}
            onClick={() => setListOpen((o) => !o)}
            data-testid="export-files-toggle"
          >
            {listOpen ? `${files(record.files.length)} ausblenden` : `${files(record.files.length)} anzeigen`}
          </Button>
          {listOpen && fileList}
        </>
      )}
    </div>
  );
}

/**
 * Beleg-Karte einer aktuellen Ausgabe (Issue #192): der Einsatz in wenigen gezählten Tatsachen, die volle
 * Montage-ID und der Weg in den Viewer. Direkt nach der Ausgabe trägt sie den Versatzschatten aus dem
 * Infografik-Leitfaden (Zeichen für „Ergebnis“, in der App nur hier); beim Wiederkommen ist sie flach. Kein Ton,
 * keine Bewegung.
 */
function ExportReceipt({
  record,
  card,
  fresh,
  viewerFile,
  filesOpen,
  onToggleFiles,
  onShowFolder,
  children,
}: {
  record: ExportStatus["record"];
  card: ExportCard | null;
  fresh: boolean;
  viewerFile: string | undefined;
  filesOpen: boolean;
  onToggleFiles: () => void;
  onShowFolder: () => void;
  /** Hinweise und Dateiliste, unten in der Karte. */
  children?: ReactNode;
}) {
  const n = record.files.length;
  const facts: [string, string, string?][] = card
    ? [
        ...(card.from && card.to
          ? [
              ["Zeitraum", card.from === card.to ? `${card.from} Uhr` : `${card.from} bis ${card.to} Uhr`] as [
                string,
                string,
              ],
            ]
          : []),
        [
          "Quellen",
          `${card.sources} ${card.sources === 1 ? "Datei" : "Dateien"}` +
            (card.devices ? ` von ${card.devices} ${card.devices === 1 ? "Gerät" : "Geräten"}` : ""),
        ],
        ["Einsatztranskript", `${card.lines} ${card.lines === 1 ? "Zeile" : "Zeilen"}`],
        ["Montage-ID", card.montageId, "font-mono tracking-wide"],
      ]
    : [];
  return (
    <section
      aria-label="Ergebnis der Ausgabe"
      data-testid="export-receipt"
      data-fresh={fresh || undefined}
      className={cx(
        "relative rounded-lg border bg-panel px-5 py-4",
        fresh ? "receipt-raised border-ink/70" : "border-line-2",
      )}
    >
      <FlagMark size={20} className="absolute top-4 right-5 text-accent" />
      <p className="pr-8 font-serif text-[1.3rem] leading-snug">
        <span className="text-good">{fresh ? "Fertig." : "Aktuell."}</span>{" "}
        {!card ? (
          <>
            {files(n)} im Ordner „{fileName(record.dir)}“
          </>
        ) : fresh ? (
          <>„{card.title}“ ist ausgegeben.</>
        ) : (
          <>Die Ausgabe von „{card.title}“ passt zum jetzigen Stand.</>
        )}
      </p>
      <p className="text-[0.88rem] text-muted">
        {card && (
          <>
            {germanDate(card.date)}
            {card.place && `, ${card.place}`} ·{" "}
          </>
        )}
        ausgegeben am {when(record.exportedAt)}
      </p>
      {card && (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2" data-testid="export-receipt-facts">
          {facts.map(([label, value, cls]) => (
            <div key={label}>
              <dt className="text-[0.82rem] text-muted">{label}</dt>
              <dd className={cx("text-[0.95rem] font-semibold tabular-nums", cls)}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2">
        {viewerFile && (
          <Button
            variant="primary"
            onClick={() => void api.openExportFile(record.sessionId, viewerFile)}
            title={viewerFile}
            data-testid="export-open-viewer"
          >
            Im Viewer ansehen
          </Button>
        )}
        <Button onClick={onShowFolder}>Im Ordner zeigen</Button>
        <span className="flex-1" />
        <Button
          variant="link"
          className="text-[0.9rem]"
          aria-expanded={filesOpen}
          aria-controls={`export-files-${record.sessionId}`}
          onClick={onToggleFiles}
          data-testid="export-files-toggle"
        >
          {filesOpen ? `${files(n)} ausblenden` : `${files(n)} anzeigen`}
        </Button>
      </div>
      {children}
    </section>
  );
}

/**
 * Was die Prüfung der Originale (erster Schritt der Ausgabe, nach der Ordnerwahl) gefunden hat. Fehlt eine Datei, die die Ausgabe braucht, geht es nicht weiter;
 * Veränderungen und fehlende, aber nicht gebrauchte Dateien lassen sich bewusst übergehen.
 */
function PreCheckResult({
  view,
  result,
  parent,
  onOriginals,
  onContinue,
  onCancel,
}: {
  view: SessionView;
  result: OriginalsCheck;
  /** Schon gewählter Ordner: „Trotzdem ausgeben“ geht ohne Nachfrage dorthin. */
  parent: string;
  onOriginals: () => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const byId = new Map(view.rows.map((r) => [r.id, r]));
  const detail = new Map(result.checks.map((c) => [c.sourceId, c]));
  const line = (id: string) => {
    const r = byId.get(id);
    const c = detail.get(id);
    return (
      <li key={id}>
        <b className="font-mono font-semibold">{r?.label ?? "?"}</b> {r?.fileName}:{" "}
        {c ? `${FILE_STATE_TEXT[c.state]} (${c.detail})` : ""}
      </li>
    );
  };
  const blocked = result.blocking.length > 0;
  return (
    <section
      className="mt-5 rounded-lg bg-warn-soft px-3 py-2.5 text-[0.9rem]"
      role="alert"
      data-testid="export-originals"
    >
      {blocked ? (
        <>
          <b className="block font-semibold text-bad">
            {result.blocking.length === 1
              ? "Feldspur findet eine Originaldatei nicht, ohne sie geht die Ausgabe nicht"
              : `Feldspur findet ${result.blocking.length} Originaldateien nicht, ohne sie geht die Ausgabe nicht`}
          </b>
          <ul className="my-1 grid gap-0.5 text-[0.86rem]">{result.blocking.map(line)}</ul>
        </>
      ) : null}
      {result.warnings.length > 0 && (
        <>
          <b className={`block font-semibold text-warn ${blocked ? "mt-2" : ""}`}>
            {blocked ? "Außerdem" : "Auffällig, die Ausgabe geht trotzdem"}
          </b>
          <ul className="my-1 grid gap-0.5 text-[0.86rem]">{result.warnings.map(line)}</ul>
          <p className="text-[0.84rem] text-muted">
            Verändert heißt: Die Datei ist nicht mehr die beim Einsammeln. Das Begleitprotokoll nennt die Prüfsumme vom
            Einsammeln.
          </p>
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant={blocked ? "primary" : "default"} onClick={onOriginals}>
          Originale suchen…
        </Button>
        {!blocked && (
          <Button size="sm" onClick={onContinue} title={`Ausgeben nach: ${parent}`} data-testid="export-anyway">
            Trotzdem ausgeben
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </section>
  );
}

/** Zusammengehörige Schalter unter einer kleinen Überschrift. */
function OptionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 font-sans text-[0.82rem] font-semibold tracking-normal text-muted">{title}</h3>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function Option({
  checked,
  onChange,
  disabled,
  label,
  size,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Festgehalten, weil eine andere Wahl davon abhängt; der Grund steht dann im Hinweis. */
  disabled?: boolean;
  label: string;
  /** Geschätzte Größe hinter der Beschriftung, z. B. „ca. 2,1 GB“. */
  size?: string;
  hint: string;
}) {
  return (
    <label
      className={cx(
        "grid grid-cols-[auto_1fr] items-center gap-x-2.5 text-[0.95rem]",
        disabled && "cursor-not-allowed",
      )}
    >
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <span>
        {label}
        {size && <span className="ml-1.5 text-[0.85rem] text-muted tabular-nums">{size}</span>}
        {disabled && <span className="ml-1.5 text-[0.8rem] text-muted">(gesperrt)</span>}
      </span>
      <span className="col-start-2 text-[0.85rem] text-muted">{hint}</span>
    </label>
  );
}

/** Karte „Kontext (n)“: Reihenfolge vor der Chronologie, mit ↑ ↓; Kontext zählt nicht als offen. */
function ContextCard({ view, onView }: { view: SessionView; onView: (v: SessionView) => void }) {
  const items = view.context;
  const untitled = items.filter((c) => !c.title).length;
  const gone = new Set(view.rows.filter((r) => r.file === "missing" || r.file === "unreadable").map((r) => r.id));
  const missing = items.filter((c) => c.thumb && gone.has(c.thumb.sourceId)).length;
  const move = (key: string, to: number) => void api.moveContext(key, to).then(onView, () => {});
  return (
    <section className="mt-5 border-t border-line pt-3 text-[0.9rem]" data-testid="export-context">
      <b className="inline-flex items-center gap-1.5 font-semibold">
        <ContextMark decorative />
        Kontext ({items.length})
      </b>
      <p className="mb-1.5 text-[0.85rem] text-muted">
        Steht vor der ersten Zeitmarke, in dieser Reihenfolge. Kontext zählt nicht als offen.
      </p>
      <ol className="grid gap-0.5">
        {items.map((c) => (
          <li key={c.key} className="flex items-center gap-2">
            <b className="w-5 text-right font-mono text-ink-2">{c.position}</b>
            <span className="min-w-0 flex-1 truncate" title={c.find}>
              {c.name}
            </span>
            {items.length > 1 && (
              <span className="flex">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={c.position <= 1}
                  aria-label={`${c.name} weiter nach vorn`}
                  title="weiter nach vorn"
                  onClick={() => move(c.key, c.position - 1)}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={c.position >= items.length}
                  aria-label={`${c.name} weiter nach hinten`}
                  title="weiter nach hinten"
                  onClick={() => move(c.key, c.position + 1)}
                >
                  ↓
                </Button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[0.85rem] text-muted">
        {untitled
          ? `${untitled} ohne Titel: Im Dokument steht die Fundstelle.`
          : missing
            ? `✓ Alle haben einen Titel. ${missing === 1 ? "Ein Bild fehlt" : `${missing} Bilder fehlen`} (Originale).`
            : "✓ Alle haben einen Titel. Alle Bilder sind vorhanden."}
      </p>
    </section>
  );
}
