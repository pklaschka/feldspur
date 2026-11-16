import { Tabs } from "radix-ui";
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ProjectInfo, SessionPatch, SessionView } from "../shared/api.ts";
import { Collect } from "./Collect.tsx";
import { DiaryEditor } from "./DiaryEditor.tsx";
import { ExportStep } from "./ExportStep.tsx";
import { ExportProvider, percent, useExport } from "./exportState.tsx";
import { formatDay } from "./format.ts";
import { Inspector, type Todo } from "./Inspector.tsx";
import { renderOverlays } from "./overlay.ts";
import { ProjectMenu, RecentList } from "./Recent.tsx";
import { ResizeHandle, usePaneWidth } from "./resize.tsx";
import { renderImageRefJpeg } from "./stillRender.ts";
import { Review } from "./Review.tsx";
import { PlaybackProvider } from "./playback.tsx";
import { Preview } from "./Preview.tsx";
import { QuickSearch, type Reveal } from "./SearchDialog.tsx";
import { SessionDetails } from "./SessionDetails.tsx";
import { SourceActionsProvider, type SourceActions } from "./SourceMenu.tsx";
import { Transcriber } from "./Transcriber.tsx";
import { Sync } from "./Sync.tsx";
import { Button, cx, Panel, TooltipProvider } from "./ui.tsx";

import iconUrl from "../../../../packaging/icon.svg?url";

const api = window.feldspur;

export type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

/** Das App-Symbol (Feldmarker auf Notizpapier) mit Namen. */
function Logo({ small }: { small?: boolean }) {
  return (
    <div
      className={cx("flex items-center gap-2.5 font-serif font-semibold", small ? "text-[1.2rem]" : "text-[1.9rem]")}
    >
      <img src={iconUrl} alt="" className={small ? "size-7" : "size-12"} />
      Feldspur
    </div>
  );
}

export function App() {
  // Auf großen Bildschirmen (1080p, 1440p) bekommen Einsatzliste und Seitenleiste von Anfang an mehr Platz.
  const wide = window.innerWidth >= 2200 ? 2 : window.innerWidth >= 1700 ? 1 : 0;
  const nav = usePaneWidth("einsaetze", [210, 230, 250][wide]!, 150, 420);
  const inspector = usePaneWidth("seitenleiste", [310, 360, 420][wide]!, 260, 720);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectMenu, setProjectMenu] = useState(false);

  // Strg/⌘+O: Projektmenü mit den zuletzt geöffneten (auf dem Startbildschirm: Öffnen-Dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "o") return;
      e.preventDefault();
      if (hasProject.current) setProjectMenu(true);
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
  const hasProject = useRef(false);
  hasProject.current = !!project;

  const guard: Guard = useCallback(async (fn) => {
    try {
      setError(null);
      return await fn();
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      return undefined;
    }
  }, []);

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
          {error && <p className="mt-3 text-bad">{error}</p>}
        </Panel>
      </main>
    );
  }

  return (
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
              />
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
            <NewSessionForm onCreate={(input) => void guard(() => api.createSession(input)).then(adoptNew)} />
          </nav>
          {sessionId ? (
            <SessionPane
              key={sessionId}
              sessionId={sessionId}
              guard={guard}
              error={error}
              onProject={(p) => {
                setProject(p);
                // Rückgängig kann den offenen Einsatz entfernen (Anlegen rückgängig): dann einen anderen zeigen.
                if (!p.sessions.some((x) => x.id === sessionId)) setSessionId(p.sessions[0]?.id ?? null);
              }}
            />
          ) : (
            <main className="col-span-2 p-8">
              {error && <p className="text-bad">{error}</p>}
              <h2 className="mb-1 text-[1.4rem] font-semibold">Noch kein Einsatz</h2>
              <p className="max-w-[52ch] text-muted">
                Ein Einsatz ist ein Tag im Feld, zum Beispiel „Wochenmarkt Südstadt“. Lege ihn links an und sammle dann
                alles ein, was an diesem Tag aufgezeichnet wurde.
              </p>
            </main>
          )}
        </div>
      </TooltipProvider>
    </ExportProvider>
  );
}

function NewSessionForm({ onCreate }: { onCreate: (i: { title: string; date: string; place: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  if (!open) {
    return (
      <button
        className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-rail-muted hover:bg-rail-hover hover:text-rail-ink"
        onClick={() => setOpen(true)}
      >
        + neuer Einsatz
      </button>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), date, place: "" });
    setOpen(false);
    setTitle("");
  };
  return (
    <form className="grid gap-1.5 p-1.5 text-ink" onSubmit={submit}>
      <input
        autoFocus
        placeholder="Titel"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Titel"
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Datum" />
      <div className="flex gap-1.5">
        <Button variant="primary" size="sm" type="submit">
          Anlegen
        </Button>
        <Button size="sm" type="button" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

const isMac = navigator.platform.toLowerCase().includes("mac");

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

function SessionPane({
  sessionId,
  guard,
  error,
  onProject,
}: {
  sessionId: string;
  guard: Guard;
  error: string | null;
  onProject: (p: ProjectInfo) => void;
}) {
  const [view, setView] = useState<SessionView | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [transcribeId, setTranscribeId] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diaryPage, setDiaryPage] = useState<string | null>(null);
  const exporting = useExport();
  const [searching, setSearching] = useState(false);
  /** Sprungziel auf der Zeitachse (Suche); n zählt hoch, damit derselbe Sprung erneut greift. */
  const [reveal, setReveal] = useState<(Reveal & { n: number }) | null>(null);
  const history = useHistory(view, sessionId, guard, setView, onProject);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    void guard(() => api.getSession(sessionId)).then((v) => {
      if (!v) return;
      setView(v);
      setStep((s) => s ?? (v.rows.length ? "review" : "collect"));
    });
  }, [sessionId, guard]);

  if (!view || !step) return <main className="col-span-2 p-8 text-muted">Lade…</main>;

  const update = (p: Promise<SessionView | undefined>) => void p.then((v) => v && setView(v));
  const sourceActions: SourceActions = {
    remove: (id) => {
      if (selected === id) setSelected(null);
      update(guard(() => api.removeSource(id)));
    },
    move: (id, target) => update(guard(() => api.moveSource(id, target))),
    mergeDevices: (from, into) => update(guard(() => api.mergeDevices(from, into))),
    setDeviceUtc: (id, utc) => update(guard(() => api.setDeviceUtc(id, utc))),
    setDeviceTimeZone: (id, tz) => update(guard(() => api.setDeviceTimeZone(id, tz))),
    setPartOf: (id, mainId) => update(guard(() => api.setPartOf(id, mainId))),
    setFollows: (id, prevId) => update(guard(() => api.setFollows(id, prevId))),
    preview: setPreviewId,
    transcribe: setTranscribeId,
  };
  const saveDetails = async (patch: SessionPatch) => {
    const res = await guard(() => api.updateSession(sessionId, patch));
    if (!res) return false;
    setView(res.view);
    onProject(res.project);
    return true;
  };
  const unsynced = view.devices.filter((d) => !d.isReference && d.offsetMs === null).length;
  const hasRef = view.devices.some((d) => d.isReference);
  const unplaced = view.rows.filter((r) => r.status === "unplaced").length;
  const toCheck = view.rows.filter((r) => r.status === "check" && !r.partOf).length;
  const steps: { id: Step; n: number; title: string; badge: string | null; warn?: boolean }[] = [
    { id: "collect", n: 1, title: "Einsammeln", badge: view.rows.length ? `${view.rows.length}` : null },
    {
      id: "sync",
      n: 2,
      title: "Abgleichen",
      badge: !view.devices.length
        ? null
        : !hasRef
          ? "Referenz fehlt"
          : view.proposals.length
            ? `${view.proposals.length} zu prüfen`
            : unsynced
              ? `${unsynced} ohne Abgleich`
              : "✓",
      warn: !hasRef || unsynced > 0 || view.proposals.length > 0,
    },
    {
      id: "review",
      n: 3,
      title: "Durchsehen",
      // Dieselben Wörter wie überall: „zu prüfen“ heißt bestätigen, „ohne …“ heißt, es fehlt noch etwas.
      badge: unplaced
        ? `${unplaced} ohne Zeit`
        : toCheck
          ? `${toCheck} zu prüfen`
          : view.episodes
            ? `${view.episodes.length} Episoden`
            : null,
      warn: unplaced > 0 || toCheck > 0,
    },
    {
      id: "export",
      n: 4,
      title: "Ausgeben",
      badge: exporting.job?.sessionId === view.session.id ? `läuft ${percent(exporting.job.progress)} %` : null,
    },
  ];
  const selectedRow = view.rows.find((r) => r.id === selected) ?? null;
  /** Sprung zu einem offenen Punkt: Schritt wechseln und die betroffene Quelle wählen. */
  const go = (t: Todo) => {
    setStep(t.step);
    if (t.sourceId) {
      setSelected(t.sourceId);
      const r = view.rows.find((x) => x.id === t.sourceId);
      if (t.step === "review" && r?.startMs != null) setReveal((old) => ({ fromMs: r.startMs!, n: (old?.n ?? 0) + 1 }));
    }
  };
  const tabContent = "flex-1 overflow-auto px-6 pt-5 pb-8 data-[state=inactive]:hidden";

  return (
    <PlaybackProvider>
      <SourceActionsProvider value={sourceActions}>
        <Tabs.Root
          value={step}
          onValueChange={(v) => setStep(v as Step)}
          className="flex min-w-0 flex-col overflow-hidden"
          asChild
        >
          <main>
            <header className="border-b border-line bg-panel px-6 pt-4">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="font-serif text-[1.05rem] text-muted italic">{formatDay(view.session.date)}</span>
                <h1 className="text-[1.6rem] leading-tight font-semibold">{view.session.title}</h1>
                {view.session.place && (
                  <span className="font-serif text-[1.05rem] text-muted italic">{view.session.place}</span>
                )}
                <Button variant="link" size="sm" onClick={() => setEditing(true)}>
                  Einsatzdaten bearbeiten
                </Button>
                <span className="ml-auto flex items-center" role="group" aria-label="Verlauf">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Rückgängig"
                    data-testid="undo"
                    disabled={!history.state.undo}
                    title={
                      history.state.undo
                        ? `Rückgängig: ${history.state.undo} (${isMac ? "⌘Z" : "Strg+Z"})`
                        : "Nichts rückgängig zu machen"
                    }
                    onClick={() => history.step(false)}
                  >
                    <HistoryGlyph />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Wiederholen"
                    disabled={!history.state.redo}
                    title={
                      history.state.redo
                        ? `Wiederholen: ${history.state.redo} (${isMac ? "⇧⌘Z" : "Strg+Y"})`
                        : "Nichts zu wiederholen"
                    }
                    onClick={() => history.step(true)}
                  >
                    <HistoryGlyph redo />
                  </Button>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearching(true)}
                  title="Mitschrift, Tagebuch, Quellen und Episoden durchsuchen (Strg/⌘+K)"
                >
                  Suchen <kbd className="ml-1 font-mono text-[0.78rem] text-muted">{isMac ? "⌘K" : "Strg+K"}</kbd>
                </Button>
              </div>
              {/* Die vier Schritte als Weg: Wegmarken, verbunden durch eine gestrichelte Spur.
               */}
              <Tabs.List className="mt-3 -mb-px flex items-center @container" aria-label="Arbeitsschritte">
                {steps.map((s, i) => (
                  <Fragment key={s.id}>
                    {i > 0 && (
                      <span
                        aria-hidden
                        className="mx-1 h-0 max-w-14 min-w-3 flex-1 border-t-2 border-dashed border-line-2"
                      />
                    )}
                    <Tabs.Trigger
                      value={s.id}
                      title={s.badge ? `${s.title}: ${s.badge}` : s.title}
                      className="group flex min-w-0 flex-none cursor-pointer items-center gap-2 border-b-[3px] border-transparent px-1.5 pt-1.5 pb-2.5 whitespace-nowrap text-ink-2 hover:text-ink data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-ink"
                    >
                      <span className="grid size-[22px] flex-none place-items-center rounded-full border border-line-2 bg-panel font-serif text-[0.85rem] text-muted group-data-[state=active]:border-accent group-data-[state=active]:bg-accent group-data-[state=active]:text-accent-ink">
                        {s.n}
                      </span>
                      {s.title}
                      {s.badge && (
                        <>
                          {/* Außen nur sichtbar/unsichtbar (not-sr-only setzt das Padding auf 0), innen die Pille. */}
                          <span className="sr-only @min-[50rem]:not-sr-only">
                            <span
                              className={cx(
                                "inline-block rounded-full px-2 py-px text-[0.8rem] leading-snug font-normal whitespace-nowrap",
                                s.warn ? "bg-warn-soft text-warn" : "bg-sunken text-muted",
                              )}
                            >
                              {s.badge}
                            </span>
                          </span>
                          {s.warn && <span aria-hidden className="size-2 rounded-full bg-warn @min-[50rem]:hidden" />}
                        </>
                      )}
                    </Tabs.Trigger>
                  </Fragment>
                ))}
              </Tabs.List>
            </header>
            {error && <p className="mx-6 mt-2 text-bad">{error}</p>}
            <Tabs.Content value="collect" className={tabContent}>
              <Collect
                view={view}
                guard={guard}
                onView={setView}
                selected={selected}
                onSelect={setSelected}
                onRename={(id, label) => update(guard(() => api.renameDevice(id, label)))}
                onOpenDiary={setDiaryPage}
                onTranscribe={setTranscribeId}
                onNext={() => setStep("sync")}
              />
            </Tabs.Content>
            <Tabs.Content value="sync" className={tabContent}>
              <Sync
                view={view}
                guard={guard}
                onView={setView}
                onReference={(id) => update(guard(() => api.setReference(id)))}
                onOffset={(id, ms) => update(guard(() => api.setDeviceOffset(id, ms)))}
                onNext={() => setStep("review")}
                onSelect={setSelected}
              />
            </Tabs.Content>
            {/* Durchsehen bleibt geladen, damit Zoom und Ausschnitt einen Schrittwechsel überstehen. */}
            <Tabs.Content value="review" className={tabContent} forceMount>
              <Review
                view={view}
                selected={selected}
                onSelect={setSelected}
                onNext={() => setStep("export")}
                onEpisodes={(on) => void saveDetails({ episodes: on })}
                onEpisodeEdit={(e) =>
                  update(
                    guard(() =>
                      e.kind === "edge"
                        ? api.moveEpisodeEdge(sessionId, e.edge, e.fromMs, e.toMs)
                        : e.kind === "loud"
                          ? api.addEpisodeAround(sessionId, e.atMs)
                          : api.resetEpisodes(sessionId),
                    ),
                  )
                }
                reveal={reveal}
              />
            </Tabs.Content>
            <Tabs.Content value="export" className={tabContent}>
              <ExportStep view={view} onGo={go} />
            </Tabs.Content>
          </main>
        </Tabs.Root>
        <Inspector
          view={view}
          // In Ausgeben zählt der Stand des ganzen Einsatzes, nicht eine einzelne Quelle.
          row={step === "export" ? null : selectedRow}
          step={step}
          onClose={() => setSelected(null)}
          onGo={go}
          actions={{
            diaryNote: (id, clock) => update(guard(() => api.setDiaryNote(id, clock))),
            addTime: async (input) => {
              const v = await guard(() => api.addTime(input));
              if (v) setView(v);
              return !!v;
            },
            confirm: (id, startMs) => update(guard(() => api.confirmPlacement(id, startMs))),
            trustDeviceClock: (id) => update(guard(() => api.setDeviceOffset(id, 0))),
            setReference: (id) => update(guard(() => api.setReference(id))),
            toggleEvidence: (id, enabled) => update(guard(() => api.setEvidenceEnabled(id, enabled))),
            removeEvidence: (id) => update(guard(() => api.removeEvidence(id))),
            setLevel: (id, input) => update(guard(() => api.setLevel(id, input))),
            measureLevel: async (id) => {
              const v = await guard(() => api.measureLevel(id));
              if (v) setView(v);
            },
            openDiary: setDiaryPage,
            transcribe: setTranscribeId,
            apply: (fn) => update(guard(fn)),
            importTranscript: async (id, mode) => {
              const r = await guard(() => api.importTranscript(id, { mode }));
              if (!r) return null;
              setView(r.view);
              return r.count;
            },
          }}
        />
        <DiaryEditor
          view={view}
          pageId={diaryPage}
          onPage={setDiaryPage}
          onClose={() => setDiaryPage(null)}
          guard={guard}
          onView={setView}
        />
        <Transcriber
          view={view}
          sourceId={transcribeId}
          onSource={setTranscribeId}
          onClose={() => setTranscribeId(null)}
          guard={guard}
          onView={setView}
        />
        <Preview view={view} sourceId={previewId} onClose={() => setPreviewId(null)} />
        <QuickSearch
          view={view}
          open={searching}
          onOpenChange={setSearching}
          onSource={setSelected}
          onTranscribe={setTranscribeId}
          onDiary={setDiaryPage}
          onReview={() => setStep("review")}
          onReveal={(r) => setReveal((old) => ({ ...r, n: (old?.n ?? 0) + 1 }))}
        />
        <SessionDetails view={view} open={editing} onOpenChange={setEditing} onSave={saveDetails} />
        <UndoToast toast={history.toast} onAction={history.step} onClose={history.dismiss} />
      </SourceActionsProvider>
    </PlaybackProvider>
  );
}

/** Schritte, nach denen ein Hinweis mit „Rückgängig“ erscheint: sie ersetzen die frühere Nachfrage. */
const NOTIFY = new Set([
  "Quelle entfernt",
  "Anker entfernt",
  "Anker gesetzt",
  "Anker geändert",
  "Vorschlag übernommen",
  "Lage bestätigt",
  "Zeitbeleg gelöscht",
  "Tagebucheintrag gelöscht",
  "Notiz gelöscht",
  "Geräte zusammengeführt",
]);

interface Toast {
  text: string;
  /** Was der Knopf im Hinweis tut: false = rückgängig, true = wiederholen. */
  redo: boolean;
  n: number;
}

/** Textfeld mit eigenem Rückgängig (Strg+Z bleibt dort beim Feld). */
function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range"].includes(el.type);
}

/** Verlauf des Projekts: Zustand für die Knöpfe, Strg/⌘+Z, Hinweis nach wichtigen Schritten. */
function useHistory(
  view: SessionView | null,
  sessionId: string,
  guard: Guard,
  setView: (v: SessionView) => void,
  onProject: (p: ProjectInfo) => void,
) {
  const [state, setState] = useState({ undo: null as string | null, redo: null as string | null, serial: 0 });
  const [toast, setToast] = useState<Toast | null>(null);
  const lastSerial = useRef<number | null>(null);
  // Nach jeder Änderung der Ansicht nachsehen, ob ein neuer Schritt dazugekommen ist.
  useEffect(() => {
    void api.historyState().then((h) => {
      setState(h);
      const before = lastSerial.current;
      lastSerial.current = h.serial;
      if (before !== null && h.serial > before && h.undo && NOTIFY.has(h.undo))
        setToast({ text: h.undo, redo: false, n: h.serial });
    });
  }, [view]);
  const step = async (redo: boolean) => {
    const r = await guard(() => (redo ? api.redo(sessionId) : api.undo(sessionId)));
    if (!r) return;
    onProject(r.project);
    if (r.view) setView(r.view);
    else setState(await api.historyState());
    setToast(
      r.label
        ? { text: `${redo ? "Wiederholt" : "Rückgängig gemacht"}: ${r.label}`, redo: !redo, n: Date.now() }
        : null,
    );
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  // Strg/⌘+Z, Strg/⌘+Umschalt+Z und Strg+Y. In Textfeldern bleibt es beim Rückgängig des Feldes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isEditable(document.activeElement)) return;
      const key = e.key.toLowerCase();
      const redo = key === "y" || (key === "z" && e.shiftKey);
      if (key !== "z" && key !== "y") return;
      e.preventDefault();
      void stepRef.current(redo);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { state, toast, step: (redo: boolean) => void step(redo), dismiss: () => setToast(null) };
}

function UndoToast({
  toast,
  onAction,
  onClose,
}: {
  toast: Toast | null;
  onAction: (redo: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.n]);
  if (!toast) return null;
  return (
    <div
      role="status"
      data-testid="undo-toast"
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-2 text-[0.92rem] text-panel shadow-lg dark:border dark:border-line-2 dark:bg-panel-2 dark:text-ink"
    >
      <span>{toast.text}</span>
      <button
        className="cursor-pointer font-semibold text-accent-soft underline-offset-2 hover:underline dark:text-accent"
        onClick={() => {
          onAction(toast.redo);
        }}
      >
        {toast.redo ? "Wiederholen" : "Rückgängig"}
      </button>
      <button className="cursor-pointer opacity-70 hover:opacity-100" aria-label="Hinweis ausblenden" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function HistoryGlyph({ redo = false }: { redo?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={redo ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M5.5 3 2.5 6l3 3" />
      <path d="M2.5 6h7a4 4 0 0 1 0 8H7" />
    </svg>
  );
}
