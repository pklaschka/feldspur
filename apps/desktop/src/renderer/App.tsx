import { Tabs } from "radix-ui";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ProjectInfo, SessionPatch, SessionView } from "../shared/api.ts";
import { Collect } from "./Collect.tsx";
import { DiaryEditor } from "./DiaryEditor.tsx";
import { ExportStep } from "./ExportStep.tsx";
import { ExportProvider, percent, useExport } from "./exportState.tsx";
import { formatDay } from "./format.ts";
import { Inspector } from "./Inspector.tsx";
import { renderOverlays } from "./overlay.ts";
import { ResizeHandle, usePaneWidth } from "./resize.tsx";
import { renderImageRefJpeg } from "./stillRender.ts";
import { Review } from "./Review.tsx";
import { PlaybackProvider } from "./playback.tsx";
import { Preview } from "./Preview.tsx";
import { QuickSearch } from "./SearchDialog.tsx";
import { SessionDetails } from "./SessionDetails.tsx";
import { SourceActionsProvider, type SourceActions } from "./SourceMenu.tsx";
import { Transcriber } from "./Transcriber.tsx";
import { Sync } from "./Sync.tsx";
import { Button, cx, Panel, TooltipProvider } from "./ui.tsx";

const api = window.feldspur;

export type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

function Logo({ small }: { small?: boolean }) {
  const bar = (c: string, x: string, w: string, y: number) => (
    <span className={cx("absolute h-[3px] rounded-full", c)} style={{ left: x, width: w, top: y }} />
  );
  return (
    <div
      className={cx("flex items-center gap-2.5 font-semibold tracking-tight", small ? "text-[1.05rem]" : "text-2xl")}
    >
      <span className="relative size-[18px] rounded-[5px] bg-sunken">
        {bar("bg-k-video", "0", "70%", 3)}
        {bar("bg-k-audio", "30%", "70%", 8)}
        {bar("bg-k-diary", "10%", "55%", 13)}
      </span>
      Feldspur
    </div>
  );
}

export function App() {
  const nav = usePaneWidth("einsaetze", 210, 150, 420);
  const inspector = usePaneWidth("seitenleiste", 310, 260, 720);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setSessionId(p?.sessions[0]?.id ?? null);
    });
  }, []);

  const adopt = (p: ProjectInfo | null | undefined) => {
    if (!p) return;
    setProject(p);
    setSessionId(p.sessions.at(-1)?.id ?? null);
  };

  if (!project) {
    return (
      <main className="grid h-full place-items-center">
        <Panel className="max-w-[440px] px-9 py-8">
          <Logo />
          <p className="my-3">Alle Aufzeichnungen eines Feldeinsatzes auf einer gemeinsamen Uhrzeit-Achse.</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void guard(api.newProject).then(adopt)}>
              Neues Projekt
            </Button>
            <Button onClick={() => void guard(api.openProject).then(adopt)}>Projekt öffnen…</Button>
          </div>
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
          <nav className="overflow-auto border-r border-line bg-panel-2 px-2.5 py-4">
            <div className="px-2">
              <Logo small />
              <div className="mt-1 truncate text-[0.8rem] text-muted" title={project.path}>
                {project.name}
              </div>
            </div>
            <div className="mx-2 mt-6 mb-1.5 text-[0.7rem] font-semibold tracking-[0.06em] text-muted uppercase">
              Einsätze
            </div>
            {project.sessions.map((s) => (
              <button
                key={s.id}
                className={cx(
                  "flex w-full cursor-pointer gap-2 rounded-[7px] px-2 py-1.5 text-left",
                  s.id === sessionId ? "bg-accent-soft font-medium text-accent" : "hover:bg-sunken",
                )}
                onClick={() => setSessionId(s.id)}
                title={s.place || undefined}
              >
                <span className={cx("pt-px font-mono text-[0.78rem]", s.id !== sessionId && "text-muted")}>
                  {formatDay(s.date)}
                </span>
                <span>{s.title}</span>
              </button>
            ))}
            <NewSessionForm onCreate={(input) => void guard(() => api.createSession(input)).then(adopt)} />
          </nav>
          {sessionId ? (
            <SessionPane key={sessionId} sessionId={sessionId} guard={guard} error={error} onProject={setProject} />
          ) : (
            <main className="col-span-2 p-8">
              {error && <p className="text-bad">{error}</p>}
              <p className="text-muted">Lege links einen Einsatz an, zum Beispiel „Wochenmarkt Südstadt“.</p>
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
        className="w-full cursor-pointer rounded-[7px] px-2 py-1.5 text-left text-muted hover:bg-sunken"
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
    <form className="grid gap-1.5 p-1.5" onSubmit={submit}>
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
              ? `${unsynced} offen`
              : "✓",
      warn: !hasRef || unsynced > 0 || view.proposals.length > 0,
    },
    {
      id: "review",
      n: 3,
      title: "Durchsehen",
      badge: unplaced ? `${unplaced} ohne Zeit` : view.episodes ? `${view.episodes.length} Episoden` : null,
      warn: unplaced > 0,
    },
    {
      id: "export",
      n: 4,
      title: "Ausgeben",
      badge: exporting.job?.sessionId === view.session.id ? `läuft ${percent(exporting.job.progress)} %` : null,
    },
  ];
  const selectedRow = view.rows.find((r) => r.id === selected) ?? null;
  const tabContent = "flex-1 overflow-auto px-5 pt-4.5 pb-6 data-[state=inactive]:hidden";

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
            <header className="border-b border-line bg-panel px-5 pt-3.5">
              <div className="flex items-baseline gap-2.5">
                <span className="font-mono text-muted">{formatDay(view.session.date)}</span>
                <h1 className="text-xl font-semibold">{view.session.title}</h1>
                {view.session.place && <span className="text-muted">{view.session.place}</span>}
                <Button variant="link" size="sm" onClick={() => setEditing(true)}>
                  Einsatzdaten bearbeiten
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setSearching(true)}
                  title="Mitschrift, Tagebuch, Quellen und Episoden durchsuchen (Strg/⌘+K)"
                >
                  Suchen <kbd className="ml-1 font-mono text-[0.72rem] text-muted">{isMac ? "⌘K" : "Strg+K"}</kbd>
                </Button>
              </div>
              <Tabs.List className="mt-3 flex gap-1" aria-label="Arbeitsschritte">
                {steps.map((s) => (
                  <Tabs.Trigger
                    key={s.id}
                    value={s.id}
                    className="group flex cursor-pointer items-center gap-2 border-b-2 border-transparent px-3 pt-2 pb-2.5 text-ink-2 hover:text-ink data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-ink"
                  >
                    <span className="grid size-[19px] place-items-center rounded-full bg-sunken text-[0.72rem] text-muted group-data-[state=active]:bg-accent group-data-[state=active]:text-accent-ink">
                      {s.n}
                    </span>
                    {s.title}
                    {s.badge && (
                      <span
                        className={cx(
                          "rounded-full px-1.5 text-[0.7rem]",
                          s.warn ? "bg-warn-soft text-warn" : "bg-sunken text-muted",
                        )}
                      >
                        {s.badge}
                      </span>
                    )}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </header>
            {error && <p className="mx-5 mt-2 text-bad">{error}</p>}
            <Tabs.Content value="collect" className={tabContent}>
              <Collect
                view={view}
                guard={guard}
                onView={setView}
                selected={selected}
                onSelect={setSelected}
                onRename={(id, label) => update(guard(() => api.renameDevice(id, label)))}
                onOpenDiary={setDiaryPage}
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
            <Tabs.Content value="review" className={tabContent}>
              {step === "review" && (
                <Review view={view} selected={selected} onSelect={setSelected} onNext={() => setStep("export")} />
              )}
            </Tabs.Content>
            <Tabs.Content value="export" className={tabContent}>
              <ExportStep view={view} />
            </Tabs.Content>
          </main>
        </Tabs.Root>
        <Inspector
          view={view}
          row={selectedRow}
          onClose={() => setSelected(null)}
          actions={{
            diaryNote: (id, clock) => update(guard(() => api.setDiaryNote(id, clock))),
            addTime: async (input) => {
              const v = await guard(() => api.addTime(input));
              if (v) setView(v);
              return !!v;
            },
            toggleEvidence: (id, enabled) => update(guard(() => api.setEvidenceEnabled(id, enabled))),
            removeEvidence: (id) => update(guard(() => api.removeEvidence(id))),
            openDiary: setDiaryPage,
            transcribe: setTranscribeId,
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
          onDiary={setDiaryPage}
          onReview={() => setStep("review")}
        />
        <SessionDetails view={view} open={editing} onOpenChange={setEditing} onSave={saveDetails} />
      </SourceActionsProvider>
    </PlaybackProvider>
  );
}
