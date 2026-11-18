import { useCallback, useEffect, useEffectEvent, useState } from "react";
import type { ProjectInfo } from "../shared/api.ts";
import { ExportProvider } from "./exportState.tsx";
import { formatDay } from "./format.ts";
import { renderOverlays } from "./overlay.ts";
import { Backups } from "./Backups.tsx";
import { ChangeLog } from "./ChangeLog.tsx";
import { ProjectMenu, RecentList } from "./Recent.tsx";
import { ResizeHandle, usePaneWidth } from "./resize.tsx";
import { renderImageRefJpeg } from "./stillRender.ts";
import { Button, cx, ErrorBanner, ErrorProvider, Panel, TooltipProvider } from "./ui.tsx";
import { HERO_TITLE_ID, Logo, NewSessionForm } from "./app/start.tsx";
import { SessionPane } from "./app/SessionPane.tsx";

const api = window.feldspur;

export type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

export function App() {
  // Auf großen Bildschirmen (1080p, 1440p) bekommen Einsatzliste und Seitenleiste von Anfang an mehr Platz.
  const wide = window.innerWidth >= 2200 ? 2 : window.innerWidth >= 1700 ? 1 : 0;
  const nav = usePaneWidth("einsaetze", [210, 230, 250][wide]!, 150, 420);
  const inspector = usePaneWidth("seitenleiste", [310, 360, 420][wide]!, 260, 720);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectMenu, setProjectMenu] = useState(false);
  const [changeLog, setChangeLog] = useState(false);
  const [backups, setBackups] = useState(false);

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
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
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

  // Ausschnitte aus PDF-Scans für Montage und Zeitgerüst zeichnet ebenfalls die Oberfläche.
  useEffect(
    () => api.onStillRequest((ref, pdf) => renderImageRefJpeg(ref as Parameters<typeof renderImageRefJpeg>[0], pdf)),
    [],
  );

  useEffect(() => {
    void api.currentProject().then((p) => {
      setProject(p);
      setSessionId(p ? lastSession(p) : null);
    });
  }, []);

  const adopt = (p: ProjectInfo | null | undefined) => {
    if (!p) return;
    setProject(p);
    setSessionId(lastSession(p));
  };
  /** Neuer Einsatz: gleich dorthin wechseln. */
  const adoptNew = (p: ProjectInfo | null | undefined) => {
    if (!p) return;
    setProject(p);
    setSessionId(p.sessions.find((s) => !project?.sessions.some((o) => o.id === s.id))?.id ?? lastSession(p));
  };
  // Den zuletzt gewählten Einsatz je Projekt merken, damit man beim nächsten Öffnen dort weitermacht.
  useEffect(() => {
    if (!project || !sessionId) return;
    try {
      localStorage.setItem(`feldspur.session:${project.path}`, sessionId);
    } catch {
      // ohne Speicher beginnt das Projekt beim ersten Einsatz
    }
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
                Neues Projekt
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
            <nav className="overflow-auto bg-rail px-2.5 py-4.5 text-rail-ink">
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
              <h2 className="mx-2 mt-7 mb-1.5 text-[1rem] font-semibold text-rail-ink">Einsätze</h2>
              {project.sessions.map((s) => (
                <button
                  key={s.id}
                  className={cx(
                    "flex w-full cursor-pointer gap-2 rounded-lg px-2 py-1.5 text-left",
                    s.id === sessionId ? "bg-rail-active font-semibold" : "hover:bg-rail-hover",
                  )}
                  onClick={() => setSessionId(s.id)}
                  title={s.place || undefined}
                >
                  <span className={cx("pt-px font-mono text-[0.82rem]", s.id !== sessionId && "text-rail-muted")}>
                    {formatDay(s.date)}
                  </span>
                  <span>{s.title}</span>
                </button>
              ))}
              <NewSessionForm
                onCreate={(input) => void guard(() => api.createSession(input)).then(adoptNew)}
                onRequestOpen={sessionId ? undefined : () => document.getElementById(HERO_TITLE_ID)?.focus()}
              />
            </nav>
            {sessionId ? (
              <SessionPane
                key={sessionId}
                sessionId={sessionId}
                guard={guard}
                onProject={(p) => {
                  setProject(p);
                  // Rückgängig kann den offenen Einsatz entfernen (Anlegen rückgängig): dann einen anderen zeigen.
                  if (!p.sessions.some((x) => x.id === sessionId)) setSessionId(p.sessions[0]?.id ?? null);
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
              </main>
            )}
          </div>
        </TooltipProvider>
      </ExportProvider>
    </ErrorProvider>
  );
}

export type Step = "collect" | "sync" | "review" | "export";

/** Zuletzt gewählter Einsatz eines Projekts (sonst der erste). */
function lastSession(p: ProjectInfo): string | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(`feldspur.session:${p.path}`);
  } catch {
    // kein Speicher
  }
  return p.sessions.find((s) => s.id === stored)?.id ?? p.sessions[0]?.id ?? null;
}
