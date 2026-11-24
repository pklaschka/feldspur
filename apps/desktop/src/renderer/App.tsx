/**
 * Wurzel der Oberfläche (Renderer), eingehängt von `apps/desktop/src/renderer/main.tsx`. Ohne Projekt zeigt sie den
 * Startbildschirm, sonst drei Spalten: links Projektmenü, Übersicht und Liste der Einsätze (`FieldSession`), in der
 * Mitte und rechts den gewählten Einsatz (`app/SessionPane.tsx`: Schritte und Detailleiste) oder die Übersicht.
 * Mit dem Hauptprozess spricht sie nur über `window.feldspur` (Schnittstelle in `apps/desktop/src/shared/api.ts`,
 * Brücke in `apps/desktop/src/preload/preload.ts`).
 */
import { useCallback, useEffect, useEffectEvent, useState } from "react";
import type { ProjectInfo } from "../shared/api.ts";
import { ExportProvider } from "./exportState.tsx";
import { errorText, formatDay } from "./format.ts";
import { renderOverlays } from "./overlay.ts";
import { Backups } from "./Backups.tsx";
import { ChangeLog } from "./ChangeLog.tsx";
import { Overview } from "./Overview.tsx";
import type { Reveal } from "./SearchDialog.tsx";
import { ProjectMenu, RecentList } from "./Recent.tsx";
import { ResizeHandle, usePaneWidth } from "./resize.tsx";
import { renderImageRefJpeg } from "./stillRender.ts";
import { Button, cx, ErrorBanner, ErrorProvider, Panel, TooltipProvider } from "./ui.tsx";
import { HERO_TITLE_ID, Logo, NewSessionForm } from "./app/start.tsx";
import { SessionPane } from "./app/SessionPane.tsx";
import { StrayDropHint, useStrayDrop } from "./app/strayDrop.tsx";
import { DeletedToast, SESSION_DELETED } from "./app/history.tsx";
import { AppFooter } from "./app/footer.tsx";
import { readStored, writeStored } from "./stored.ts";

const api = window.feldspur;

/**
 * Führt einen IPC-Aufruf aus und fängt dessen Fehler ab: Die Meldung landet im `ErrorBanner` (`ui.tsx`), der Aufrufer
 * bekommt `undefined` statt einer Ausnahme. Fast jede Komponente, die Daten ändert, bekommt `guard` durchgereicht.
 */
export type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

/** Hält, welches Projekt, welcher Einsatz und welche Ebene (Übersicht oder Einsatz) gerade offen sind. */
export function App() {
  // Auf großen Bildschirmen (1080p, 1440p) bekommen Einsatzliste und Seitenleiste von Anfang an mehr Platz.
  const wide = window.innerWidth >= 2200 ? 2 : window.innerWidth >= 1700 ? 1 : 0;
  const nav = usePaneWidth("einsaetze", [210, 230, 250][wide]!, 150, 420);
  const inspector = usePaneWidth("seitenleiste", [310, 360, 420][wide]!, 260, 720);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Die Übersicht des Projekts ist offen, die Ebene über den Einsätzen (Issue #203). */
  const [overview, setOverview] = useState(false);
  /** Schritt, in dem der nächste geöffnete Einsatz beginnt (Sprung aus der Übersicht); sonst entscheidet der Einsatz. */
  const [openStep, setOpenStep] = useState<Step | null>(null);
  /** Zeitbereich (ms, Uhrzeit des Einsatztags), den „Durchsehen“ beim Öffnen ins Bild holt; gehört zu `openStep`. */
  const [openAt, setOpenAt] = useState<Reveal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectMenu, setProjectMenu] = useState(false);
  const [changeLog, setChangeLog] = useState(false);
  const [backups, setBackups] = useState(false);
  // Dateien neben „Einsammeln“ abgelegt: Hinweis statt Stille.
  const strayDrop = useStrayDrop();
  /** Zuletzt gelöschter Einsatz: Hinweis mit „Rückgängig“, auch wenn danach kein Einsatz mehr offen ist. */
  const [deleted, setDeleted] = useState<{ id: string; title: string } | null>(null);
  /** Oberster Rückgängig-Schritt, wie ihn der offene Einsatz zuletzt gelesen hat (undefined: noch keiner). */
  const [topUndo, setTopUndo] = useState<string | null | undefined>(undefined);

  // Strg/⌘+O: Projektmenü mit den zuletzt geöffneten (auf dem Startbildschirm: Öffnen-Dialog).
  const hasProject = useEffectEvent(() => !!project);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "o") return;
      e.preventDefault();
      if (hasProject()) setProjectMenu(true);
      else
        void api.openProject().then((p) => {
          if (!p) return;
          setProject(p);
          setSessionId(lastSession(p));
        });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const guard: Guard = useCallback(async (fn) => {
    try {
      setError(null);
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    }
  }, []);
  const dismissError = useCallback(() => setError(null), []);

  // Einblendungen fürs Montagevideo zeichnet die Oberfläche (Schrift kann die LGPL-Fassung von ffmpeg nicht).
  useEffect(
    () =>
      api.onOverlayRequest((tl, frames) =>
        renderOverlays(tl as Parameters<typeof renderOverlays>[0], frames as Parameters<typeof renderOverlays>[1]),
      ),
    [],
  );

  // Ausschnitte aus PDF-Scans für Montage und Einsatztranskript zeichnet ebenfalls die Oberfläche.
  useEffect(
    () => api.onStillRequest((ref, pdf) => renderImageRefJpeg(ref as Parameters<typeof renderImageRefJpeg>[0], pdf)),
    [],
  );

  // Beim Start das Projekt übernehmen, das der Hauptprozess schon offen hat (sonst null: Startbildschirm).
  useEffect(() => {
    void api.currentProject().then((p) => {
      setProject(p);
      setSessionId(p ? lastSession(p) : null);
    });
  }, []);

  /** Ein anderes Projekt ist jetzt offen (neu, geöffnet, Sicherung als Kopie): alles auf Anfang, letzter Einsatz. */
  const adopt = (p: ProjectInfo | null | undefined) => {
    if (!p) return;
    setDeleted(null);
    setProject(p);
    setOverview(false);
    setOpenStep(null);
    setOpenAt(null);
    setSessionId(lastSession(p));
  };
  /** Einsatz öffnen, auf Wunsch in einem Schritt und (in Durchsehen) an einer Uhrzeit. */
  const openSession = (id: string, step: Step | null = null, atMs?: number) => {
    setOverview(false);
    setOpenStep(step);
    // Eine halbe Stunde um die Uhrzeit ins Bild holen.
    setOpenAt(atMs === undefined ? null : { fromMs: atMs - 15 * 60_000, toMs: atMs + 15 * 60_000 });
    setSessionId(id);
  };
  /** Neuer Einsatz: gleich dorthin wechseln. */
  const adoptNew = (p: ProjectInfo | null | undefined) => {
    if (!p) return;
    setProject(p);
    setOverview(false);
    setOpenStep(null);
    setOpenAt(null);
    setSessionId(p.sessions.find((s) => !project?.sessions.some((o) => o.id === s.id))?.id ?? lastSession(p));
  };
  /** „Rückgängig“ im Hinweis nach dem Löschen eines Einsatzes (`DeletedToast`, `app/history.tsx`). */
  const undoDelete = async () => {
    const gone = deleted;
    setDeleted(null);
    const r = await guard(async () => {
      // Nur den Löschschritt zurücknehmen, nie etwas, das inzwischen dazugekommen ist.
      const { undo } = await api.historyState();
      if (undo === null)
        throw new Error(
          "Das Löschen lässt sich nicht mehr rückgängig machen: Der Verlauf ist leer (nach dem Schließen des Projekts, nach Einsammeln oder Tonspur-Analyse). Einen früheren Stand findest du unter Sicherungen im Projektmenü.",
        );
      if (undo !== SESSION_DELETED)
        throw new Error(
          "Seit dem Löschen wurde etwas anderes geändert. Rückgängig geht Schritt für Schritt mit Strg+Z (Mac: ⌘Z).",
        );
      return api.undo(sessionId);
    });
    if (!r) return;
    setProject(r.project);
    if (gone && r.project.sessions.some((s) => s.id === gone.id)) openSession(gone.id);
  };
  // Den zuletzt gewählten Einsatz je Projekt merken, damit man beim nächsten Öffnen dort weitermacht.
  useEffect(() => {
    if (!project || !sessionId) return;
    writeStored(`feldspur.session:${project.path}`, sessionId);
  }, [project, sessionId]);

  if (!project) {
    return (
      <ErrorProvider message={error} onDismiss={dismissError}>
        <main className="grid h-full place-items-center">
          <Panel className="max-w-[480px] px-10 py-9">
            <Logo />
            <p className="mt-4 mb-1 font-serif text-[1.15rem] leading-snug text-ink-2 italic">
              Was an einem Feldtag aufgezeichnet wurde, wieder in eine gemeinsame Zeit bringen.
            </p>
            <p className="mb-5 text-muted">
              Video, Ton, Fotos, Tagebuch und Notizen liegen danach auf einer Achse, so wie der Tag war.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void guard(api.newProject).then(adopt)}>
                Neues Projekt…
              </Button>
              <Button onClick={() => void guard(api.openProject).then(adopt)}>Projekt öffnen…</Button>
            </div>
            <RecentList onOpen={(path) => void guard(() => api.openRecent(path)).then(adopt)} />
            <ErrorBanner className="mt-3">
              <Button className="mt-2" size="sm" onClick={() => void guard(() => api.openBackupCopy()).then(adopt)}>
                Sicherung als Kopie öffnen…
              </Button>
            </ErrorBanner>
          </Panel>
        </main>
        <StrayDropHint
          n={strayDrop}
          text="Öffne zuerst ein Projekt; Dateien kommen dann über „Einsammeln“ in einen Einsatz."
        />
      </ErrorProvider>
    );
  }

  return (
    <ErrorProvider message={error} onDismiss={dismissError}>
      <ExportProvider>
        <TooltipProvider delayDuration={250}>
          <div
            className="relative grid h-full"
            style={{ gridTemplateColumns: `${nav.width}px minmax(0,1fr) ${inspector.width}px` }}
          >
            <ResizeHandle pane={nav} side="left" label="Breite der Einsatzliste" left={`${nav.width}px`} />
            <ResizeHandle
              pane={inspector}
              side="right"
              label="Breite der Seitenleiste"
              left={`calc(100% - ${inspector.width}px)`}
            />
            <nav className="flex flex-col overflow-auto bg-rail px-2.5 pt-4.5 text-rail-ink">
              <div className="px-2">
                <Logo small />
                <ProjectMenu
                  name={project.name}
                  path={project.path}
                  open={projectMenu}
                  onOpenChange={setProjectMenu}
                  onOpenRecent={(path) => void guard(() => api.openRecent(path)).then(adopt)}
                  onOpenOther={() => void guard(api.openProject).then(adopt)}
                  onNew={() => void guard(api.newProject).then(adopt)}
                  onChangeLog={() => setChangeLog(true)}
                  onBackups={() => setBackups(true)}
                />
                <ChangeLog open={changeLog} onOpenChange={setChangeLog} />
                <Backups open={backups} onOpenChange={setBackups} onOpened={adopt} guard={guard} />
              </div>
              <button
                className={cx(
                  "mt-5 w-full cursor-pointer rounded-lg px-2 py-1.5 text-left",
                  overview ? "bg-rail-active font-semibold" : "hover:bg-rail-hover",
                )}
                aria-current={overview ? "page" : undefined}
                onClick={() => setOverview(true)}
              >
                Übersicht
              </button>
              <h2 className="mx-2 mt-5 mb-1.5 text-[1rem] font-semibold text-rail-ink">Einsätze</h2>
              {project.sessions.map((s) => (
                <button
                  key={s.id}
                  className={cx(
                    "flex w-full cursor-pointer gap-2 rounded-lg px-2 py-1.5 text-left",
                    s.id === sessionId && !overview ? "bg-rail-active font-semibold" : "hover:bg-rail-hover",
                  )}
                  onClick={() => openSession(s.id)}
                  title={s.place || undefined}
                >
                  <span
                    className={cx(
                      "pt-px font-mono text-[0.82rem]",
                      (s.id !== sessionId || overview) && "text-rail-muted",
                    )}
                  >
                    {formatDay(s.date)}
                  </span>
                  <span className="min-w-0 wrap-break-word hyphens-auto">{s.title}</span>
                </button>
              ))}
              <NewSessionForm
                onCreate={(input) => void guard(() => api.createSession(input)).then(adoptNew)}
                onRequestOpen={sessionId ? undefined : () => document.getElementById(HERO_TITLE_ID)?.focus()}
              />
              <AppFooter />
            </nav>
            {overview ? (
              <Overview key={project.path} name={project.name} onOpen={openSession} />
            ) : sessionId ? (
              <SessionPane
                key={sessionId}
                sessionId={sessionId}
                initialStep={openStep}
                initialReveal={openAt}
                guard={guard}
                strayDrop={strayDrop}
                onProject={(p) => {
                  setProject(p);
                  // Rückgängig kann den offenen Einsatz entfernen (Anlegen rückgängig): dann einen anderen zeigen.
                  if (!p.sessions.some((x) => x.id === sessionId)) setSessionId(p.sessions[0]?.id ?? null);
                }}
                onHistory={(h) => setTopUndo(h.undo)}
                onDeleted={(p) => {
                  const title = project.sessions.find((x) => x.id === sessionId)?.title ?? "";
                  setTopUndo(undefined);
                  setDeleted({ id: sessionId, title });
                  setProject(p);
                  setSessionId(p.sessions[0]?.id ?? null);
                }}
              />
            ) : (
              <main className="col-span-2 p-8">
                <ErrorBanner className="mb-4 max-w-[52ch]" />
                <h2 className="mb-1 text-[1.4rem] font-semibold">Noch kein Einsatz</h2>
                <p className="max-w-[52ch] text-muted">
                  Ein Einsatz ist ein Tag im Feld, zum Beispiel „Wochenmarkt Südstadt“. Lege den ersten Einsatz an und
                  sammle dann alles ein, was an diesem Tag aufgezeichnet wurde.
                </p>
                <NewSessionForm hero onCreate={(input) => void guard(() => api.createSession(input)).then(adoptNew)} />
                <StrayDropHint
                  n={strayDrop}
                  text="Lege zuerst einen Einsatz an; Dateien kommen dann über „Einsammeln“ hinein."
                  action="Einsatz anlegen"
                  onAction={() => document.getElementById(HERO_TITLE_ID)?.focus()}
                />
              </main>
            )}
            {deleted && !project.sessions.some((s) => s.id === deleted.id) && (
              <DeletedToast
                key={deleted.id}
                title={deleted.title}
                topUndo={topUndo}
                onUndo={() => void undoDelete()}
                onClose={() => setDeleted(null)}
              />
            )}
          </div>
        </TooltipProvider>
      </ExportProvider>
    </ErrorProvider>
  );
}

/**
 * Die vier Schritte (Reiter) eines Einsatzes: Einsammeln (`Collect.tsx`), Abgleichen (`Sync.tsx`), Durchsehen
 * (`Review.tsx`), Ausgeben (`ExportStep.tsx`). Mitschreiben und Tagebuch sind keine Schritte, sondern Dialoge.
 */
export type Step = "collect" | "sync" | "review" | "export";

/** Zuletzt gewählter Einsatz eines Projekts (sonst der erste). */
function lastSession(p: ProjectInfo): string | null {
  const stored = readStored(`feldspur.session:${p.path}`);
  return p.sessions.find((s) => s.id === stored)?.id ?? p.sessions[0]?.id ?? null;
}
