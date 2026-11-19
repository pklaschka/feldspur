/** Ein Einsatz: Schritte, Detailleiste und alle Dialoge, die dazugehören. */
import { Tabs } from "radix-ui";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ProjectInfo, SessionPatch, SessionView } from "../../shared/api.ts";
import { Collect } from "../Collect.tsx";
import { DiaryEditor } from "../DiaryEditor.tsx";
import { ExportStep } from "../ExportStep.tsx";
import { percent, useExport } from "../exportState.tsx";
import { formatDay } from "../format.ts";
import { Inspector } from "../Inspector.tsx";
import { OriginalsBanner, OriginalsDialog } from "../Originals.tsx";
import { isMac } from "../keys.ts";
import { asPlaces, checkQueue, firstOpen, placesAfter, type Todo } from "../inspector/status.ts";
import { rowStart } from "../review/tracks.ts";
import { Review } from "../Review.tsx";
import { PlaybackProvider } from "../playback.tsx";
import { Preview } from "../Preview.tsx";
import { QuickSearch, type Reveal } from "../SearchDialog.tsx";
import { SessionDetails } from "../SessionDetails.tsx";
import { SourceActionsProvider, type SourceActions } from "../SourceMenu.tsx";
import { Transcriber } from "../Transcriber.tsx";
import { Sync } from "../Sync.tsx";
import { Button, cx, ErrorBanner } from "../ui.tsx";
import { HistoryGlyph, UndoToast, useHistory, type HistoryState } from "./history.tsx";
import type { Guard, Step } from "../App.tsx";

const api = window.feldspur;

export function SessionPane({
  sessionId,
  guard,
  onProject,
  onDeleted,
  onHistory,
}: {
  sessionId: string;
  guard: Guard;
  onProject: (p: ProjectInfo) => void;
  /** Der Einsatz wurde gelöscht; `p` ist das Projekt danach. */
  onDeleted: (p: ProjectInfo) => void;
  /** Jeder neu gelesene Stand des Verlaufs. */
  onHistory?: (h: HistoryState) => void;
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
  const [originals, setOriginals] = useState(false);
  /** Sprungziel auf der Zeitachse (Suche); n zählt hoch, damit derselbe Sprung erneut greift. */
  const [reveal, setReveal] = useState<(Reveal & { n: number }) | null>(null);
  const history = useHistory(view, sessionId, guard, setView, onProject, onHistory);
  /** „Lage passt“ läuft: weitere Bestätigungen (zweites Strg+Enter, Doppelklick) bis zur Antwort verwerfen. */
  const confirming = useRef(false);

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
    setSourceKind: (id, kind) => update(guard(() => api.setSourceKind(id, kind))),
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
  const deleteSession = () => void guard(() => api.deleteSession(sessionId)).then((p) => p && onDeleted(p));
  const unsynced = view.devices.filter((d) => !d.isReference && d.offsetMs === null).length;
  const hasRef = view.devices.some((d) => d.isReference);
  const unplaced = view.rows.filter((r) => r.status === "unplaced").length;
  const toCheck = asPlaces(checkQueue(view.rows), view.conflictGroups).length;
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
  /**
   * „Lage passt“. In Durchsehen geht es danach zur nächsten zu prüfenden Stelle (vorab bestimmt, damit die
   * Reihenfolge der Prüfliste gilt); ist keine mehr übrig, bleibt die Auswahl und der Hinweis sagt es.
   */
  const confirm = (id: string, startMs: number) => {
    if (confirming.current) return;
    confirming.current = true;
    const order = step === "review" ? placesAfter(checkQueue(view.rows), view.conflictGroups, id) : null;
    void guard(() => api.confirmPlacement(id, startMs)).then((v) => {
      confirming.current = false;
      if (!v) return;
      const queue = checkQueue(v.rows);
      if (order && !queue.length) history.note("Alle Stellen geprüft");
      setView(v);
      const next = order && firstOpen(order, queue, v.conflictGroups);
      if (!next) return;
      setSelected(next.id);
      setReveal((old) => ({ fromMs: rowStart(next), n: (old?.n ?? 0) + 1 }));
    });
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
                {/* Eigene Zeile in der Mitte statt an der Grundlinie: Symbole haben keine Grundlinie wie Text. */}
                <span className="ml-auto flex items-center gap-0.5 self-center">
                  <span className="flex items-center gap-0.5" role="group" aria-label="Verlauf">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="inline-grid size-7 place-items-center px-0! py-0!"
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
                      className="inline-grid size-7 place-items-center px-0! py-0!"
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
                    className="h-7"
                    onClick={() => setSearching(true)}
                    title="Mitschrift, Tagebuch, Quellen und Episoden durchsuchen (Strg/⌘+K)"
                  >
                    Suchen <kbd className="ml-1 font-mono text-[0.78rem] text-muted">{isMac ? "⌘K" : "Strg+K"}</kbd>
                  </Button>
                </span>
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
            <OriginalsBanner view={view} onOpen={() => setOriginals(true)} />
            <ErrorBanner className="mx-6 mt-2" />
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
                onSetDate={(date) => saveDetails({ date })}
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
                active={step === "review"}
                onConfirm={(r) => confirm(r.id, r.startMs!)}
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
              <ExportStep view={view} onGo={go} onView={setView} onOriginals={() => setOriginals(true)} />
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
            confirm,
            decide: (input) => update(guard(() => api.decidePlacement(input))),
            decideMany: (sourceIds, kind, reason) => update(guard(() => api.decideMany({ sourceIds, kind, reason }))),
            setDeviceUtc: (id, utc) => update(guard(() => api.setDeviceUtc(id, utc))),
            setDeviceOffset: (id, ms) => update(guard(() => api.setDeviceOffset(id, ms))),
            goSync: () => go({ text: "", step: "sync", action: "" }),
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
            relinkOriginal: (id) => void guard(() => api.relinkOriginal(id)).then((v) => v && setView(v)),
            openOriginals: () => setOriginals(true),
            importTranscript: async (id, mode) => {
              const r = await guard(() => api.importTranscript(id, { mode }));
              if (!r) return null;
              setView(r.view);
              return { count: r.count, dropped: r.dropped };
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
        <OriginalsDialog view={view} open={originals} onOpenChange={setOriginals} onView={setView} guard={guard} />
        <SessionDetails
          view={view}
          open={editing}
          onOpenChange={setEditing}
          onSave={saveDetails}
          onDelete={deleteSession}
        />
        <UndoToast
          view={view}
          toast={history.toast}
          onAction={history.step}
          onClose={history.dismiss}
          onSource={setSelected}
          onTranscribe={setTranscribeId}
          onDiary={setDiaryPage}
          onReview={() => setStep("review")}
          onReveal={(r) => setReveal((old) => ({ ...r, n: (old?.n ?? 0) + 1 }))}
        />
      </SourceActionsProvider>
    </PlaybackProvider>
  );
}
