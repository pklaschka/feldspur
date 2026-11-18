/**
 * Schritt „Ausgeben“: ein Ordner pro Einsatz mit Montagevideo, Zeitgerüst (.docx), Dokumentvariablen und
 * Begleitprotokoll.
 */
import { useEffect, useState } from "react";
import type { OriginalsCheck, OriginalsProgress, ScaffoldPreview, SessionView } from "../shared/api.ts";
import { percent, remainingMs, remainingText, useExport } from "./exportState.tsx";
import { formatDuration } from "@feldspur/core/time";
import { MontageView } from "./MontageView.tsx";
import { ScaffoldLine } from "./ScaffoldLine.tsx";
import { todos, type Todo } from "./inspector/status.ts";
import { TodoList } from "./inspector/Summary.tsx";
import { FILE_STATE_TEXT, progressText } from "./Originals.tsx";
import { Button, Notice, Panel, StepHeader, Toggle } from "./ui.tsx";

const api = window.feldspur;

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const FILE_ROLE: [RegExp, string][] = [
  [/\.mp4$/, "Montagevideo zum Zuordnen: Uhrzeit, Videos und Ton mit Herkunft, Montage-ID"],
  [/\.docx$/, "Zeitgerüst für MAXQDA, mit Zeitmarken zum Video, Mitschrift und Bildern"],
  [/\.xlsx$/, "Dokumentvariablen für MAXQDA (Variablen › Dokumentvariablen importieren)"],
  [/\.csv$/, "Begleitprotokoll: Herkunft und Zeitnachweis jeder Datei"],
  [/\.fcpxml$/, "Schnittliste für DaVinci Resolve (Datei › Importieren › Timeline)"],
];

/** Ausgabe-Einstellungen gelten für alle Einsätze und bleiben bis zur nächsten Sitzung erhalten. */
interface Options {
  video: boolean;
  resolve: boolean;
  mixAudio: boolean;
  byEpisodes: boolean;
}
const DEFAULTS: Options = { video: true, resolve: false, mixAudio: true, byEpisodes: false };
const KEY = "feldspur.export-options";
function loadOptions(): Options {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Options>) };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Stand des Zeitgerüsts beim Start der letzten Ausgabe je Einsatz. Weicht die Vorschau danach ab, ist das
 * Ergebnis veraltet. Gilt bis zum Neustart; danach fehlt der Vergleich und es gibt keinen Hinweis.
 */
const exportedWith = new Map<string, string>();

/** Prüfung der Originale vor einer Ausgabe: läuft, oder hat etwas gefunden (dann entscheidet die Person). */
type PreCheck =
  | { phase: "running"; progress: OriginalsProgress | null }
  | { phase: "found"; result: OriginalsCheck; video: boolean; paths: string };

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
  const [preview, setPreview] = useState<ScaffoldPreview | null>(null);
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
  const { video, resolve, mixAudio, byEpisodes } = opts;
  const [watching, setWatching] = useState(false);
  const withEpisodes = view.session.episodes;
  const realtime = !(withEpisodes && byEpisodes);
  const ex = useExport();
  const sessionId = view.session.id;
  const busy = ex.job?.sessionId === sessionId;
  const elsewhere = !!ex.job && !busy;
  const progress = busy ? ex.job!.progress : null;
  const result = busy ? null : (ex.results[sessionId] ?? null);
  const error = busy ? null : (ex.errors[sessionId] ?? null);

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
  const [pre, setPre] = useState<PreCheck | null>(null);
  useEffect(
    () =>
      api.onOriginalsProgress(
        (p) => p.sessionId === sessionId && setPre((old) => (old?.phase === "running" ? { ...old, progress: p } : old)),
      ),
    [sessionId],
  );
  // Ein Ergebnis gilt nur für die Einstellung (mit/ohne Video) und die Pfade, mit denen geprüft wurde.
  const paths = view.rows.map((r) => r.originalPath).join("\n");
  const found = pre?.phase === "found" && pre.video === video && pre.paths === paths ? pre : null;
  const running = pre?.phase === "running" ? pre : null;
  const start = () => {
    setPre(null);
    if (preview) exportedWith.set(sessionId, preview.lines.join("\n"));
    ex.start(sessionId, { video, resolve, mixAudio, realtime });
  };
  /** Erst die Originale prüfen (Prüfsummen schon geprüfter Dateien merkt sich die App), dann ausgeben. */
  const run = async () => {
    setPre({ phase: "running", progress: null });
    let result: OriginalsCheck;
    try {
      result = await api.checkOriginals(sessionId, video);
    } catch {
      setPre(null);
      return start(); // Prüfen ging nicht: die Ausgabe meldet selbst, was fehlt.
    }
    void api.getSession(sessionId).then(onView, () => {});
    if (!result.blocking.length && !result.warnings.length) return start();
    setPre({ phase: "found", result, video, paths });
  };
  const before = exportedWith.get(sessionId);
  const stale = !!result && !!preview && before !== undefined && before !== preview.lines.join("\n");

  const empty = !preview || preview.durationMs <= 0;
  const pct = percent(progress);
  const open = todos(view);

  return (
    <>
      <StepHeader
        className="max-w-[1240px]"
        title="Ausgeben"
        summary="Ein Ordner pro Einsatz: Montagevideo, Zeitgerüst für MAXQDA und Begleitprotokoll."
        help={
          <>
            <p className="mb-1.5">
              In MAXQDA das Zeitgerüst (.docx) als Transkript importieren und das Montagevideo als Mediendatei zuordnen.
              Die Zeitmarken <code>#hh:mm:ss-z#</code> zeigen auf Stellen im Video; die echte Uhrzeit steht in jeder
              Zeile dahinter.
            </p>
            <p className="mb-1.5">
              Das Video zeigt nur, was zum Zuordnen nötig ist: Uhrzeit, die laufenden Videos (gleichzeitige
              nebeneinander) mit Datei und Stelle im Original, die laufenden Tonquellen und eine Montage-ID, die auch im
              Kopf des Zeitgerüsts steht. Fotos und Tagebuch stehen im Zeitgerüst.
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
      {(busy || result || error) && (
        <Panel className="mb-4 max-w-[1240px]">
          {busy && (
            <div data-testid="export-progress">
              <div className="mb-1 flex justify-between text-[0.9rem]">
                <span>{progress?.step ?? "Vorbereiten"}</span>
                <span className="text-muted tabular-nums">
                  {progress?.step === "Montagevideo" && `${remainingText(remainingMs(ex.job))} · `}
                  {pct} %
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-[0.85rem] text-muted">
                Du kannst weiterarbeiten oder den Schritt wechseln, die Ausgabe läuft weiter. Änderungen ab jetzt kommen
                in die nächste Ausgabe.
              </p>
            </div>
          )}
          {error && <Notice>Ausgabe fehlgeschlagen: {error}</Notice>}
          {result && (
            <div data-testid="export-result">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="font-serif text-[1.1rem]">
                  {stale ? <span className="text-warn">Veraltet.</span> : <span className="text-good">Fertig.</span>}{" "}
                  {result.files.length} Dateien im Ordner „{fileName(result.dir)}“.
                </p>
                <Button size="sm" onClick={() => void api.showInFolder(result.files[0] ?? result.dir)}>
                  Im Ordner zeigen
                </Button>
              </div>
              <ul className="mt-2 grid gap-1.5">
                {result.files.map((f) => (
                  <li key={f} className="text-[0.9rem]">
                    <span className="font-medium break-all">{fileName(f)}</span>
                    <span className="block text-[0.85rem] text-muted">
                      {FILE_ROLE.find(([re]) => re.test(f))?.[1] ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
              {stale ? (
                <div
                  className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-warn/8 px-3 py-2"
                  role="status"
                  data-testid="export-stale"
                >
                  <p className="text-[0.9rem] text-warn">
                    Seit dieser Ausgabe hat sich etwas geändert. Nur Geändertes wird neu gerechnet.
                  </p>
                  <Button size="sm" disabled={!!ex.job || !!running || !!found} onClick={() => void run()}>
                    Erneut ausgeben…
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-[0.85rem] text-muted">
                  Änderst du danach noch etwas, gib den Einsatz einfach erneut aus; nur Geändertes wird neu gerechnet.
                </p>
              )}
            </div>
          )}
        </Panel>
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
                Montage ansehen
              </Button>
            </p>
            <MontageView
              sessionId={sessionId}
              realtime={realtime}
              open={watching}
              onOpenChange={setWatching}
              levels={new Map(view.rows.map((r) => [r.id, r.level]))}
            />
            <div className="mt-4 grid gap-3">
              {withEpisodes && (
                <Option
                  checked={byEpisodes}
                  onChange={(v) => set({ byEpisodes: v })}
                  label="Nach Episoden schneiden"
                  hint="Kürzer, aber Videozeit ≠ Uhrzeit. Aus: der ganze Einsatz in Echtzeit."
                />
              )}
              <Option
                checked={video}
                onChange={(v) => set({ video: v })}
                label="Montagevideo mit ausgeben"
                hint="Dauert einige Minuten. Aus: nur Zeitgerüst und Protokoll."
              />
              <Option
                checked={mixAudio}
                onChange={(v) => set({ mixAudio: v })}
                label="Ton aller Geräte mischen"
                hint="Aus: nur der Ton der Hauptquelle."
              />
              <Option
                checked={resolve}
                onChange={(v) => set({ resolve: v })}
                label="Schnittliste für DaVinci Resolve"
                hint="Dieselbe Montage als FCPXML, ohne Einblendungen."
              />
            </div>
            {!withEpisodes && (
              <p className="mt-3 text-[0.85rem] text-muted">
                Nach Episoden schneiden geht, wenn unter „Durchsehen“ Episoden eingeschaltet sind.
              </p>
            )}
            {open.length > 0 && !empty && (
              <section className="mt-5 border-t border-line pt-3 text-[0.9rem]" data-testid="export-open">
                <b className="block font-semibold text-warn">Noch offen</b>
                <p className="mb-1.5 text-[0.85rem]">
                  Ausgeben geht trotzdem; was offen ist, steht dann so im Zeitgerüst, wie es gerade liegt.
                </p>
                <TodoList items={open} onGo={onGo} />
              </section>
            )}
            {found && (
              <PreCheckResult
                view={view}
                result={found.result}
                onOriginals={onOriginals}
                onContinue={start}
                onCancel={() => setPre(null)}
              />
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={!!ex.job || empty || !!running || !!found} onClick={() => void run()}>
                {busy ? "Gibt aus…" : running ? "Prüft Originale…" : open.length ? "Trotzdem ausgeben…" : "Ausgeben…"}
              </Button>
              {running && (
                <span className="text-[0.85rem] text-muted tabular-nums" data-testid="export-precheck">
                  {progressText(running.progress)}
                </span>
              )}
              {empty && <span className="text-[0.9rem] text-muted">Noch keine Quelle mit Uhrzeit.</span>}
              {elsewhere && (
                <span className="text-[0.9rem] text-muted">Ein anderer Einsatz wird gerade ausgegeben.</span>
              )}
            </div>
          </Panel>
          <Panel className="min-w-0">
            <h3 className="mb-2 text-[1rem] font-semibold">Vorschau des Zeitgerüsts</h3>
            <ol
              className="max-h-[calc(100vh-16rem)] overflow-y-auto font-serif text-[0.92rem] leading-relaxed text-ink-2"
              data-testid="scaffold-preview"
            >
              {preview?.entries.map((e, i) => (
                <ScaffoldLine key={i} entry={e} />
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * Was die Prüfung der Originale gefunden hat. Fehlt eine Datei, die die Ausgabe braucht, geht es nicht weiter;
 * Veränderungen und fehlende, aber nicht gebrauchte Dateien lassen sich bewusst übergehen.
 */
function PreCheckResult({
  view,
  result,
  onOriginals,
  onContinue,
  onCancel,
}: {
  view: SessionView;
  result: OriginalsCheck;
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
              ? "Eine Originaldatei fehlt, ohne sie geht die Ausgabe nicht"
              : `${result.blocking.length} Originaldateien fehlen, ohne sie geht die Ausgabe nicht`}
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
          <Button size="sm" onClick={onContinue} data-testid="export-anyway">
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

function Option({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="grid grid-cols-[auto_1fr] items-center gap-x-2.5 text-[0.95rem]">
      <Toggle checked={checked} onChange={onChange} label={label} />
      {label}
      <span className="col-start-2 text-[0.85rem] text-muted">{hint}</span>
    </label>
  );
}
