import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ProjectInfo, SessionView } from "../shared/api.ts";
import { Collect } from "./Collect.tsx";
import { formatDay } from "./format.ts";
import { Inspector } from "./Inspector.tsx";
import { Review } from "./Review.tsx";
import { Sync } from "./Sync.tsx";

const api = window.feldspur;

export type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

export function App() {
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
      <main className="welcome">
        <div className="welcome-card">
          <div className="logo">
            <span className="logo-mark" />
            Feldspur
          </div>
          <p>Alle Aufzeichnungen eines Feldeinsatzes auf einer gemeinsamen Uhrzeit-Achse.</p>
          <div className="row">
            <button className="btn pri" onClick={() => void guard(api.newProject).then(adopt)}>
              Neues Projekt
            </button>
            <button className="btn" onClick={() => void guard(api.openProject).then(adopt)}>
              Projekt öffnen…
            </button>
          </div>
          {error && <p className="err">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <div className="shell">
      <nav className="side">
        <div className="logo small-logo">
          <span className="logo-mark" />
          Feldspur
        </div>
        <div className="proj" title={project.path}>
          {project.name}
        </div>
        <div className="eyebrow">Einsätze</div>
        {project.sessions.map((s) => (
          <button
            key={s.id}
            className={`sess ${s.id === sessionId ? "on" : ""}`}
            onClick={() => setSessionId(s.id)}
            title={s.place || undefined}
          >
            <span className="sess-date mono">{formatDay(s.date)}</span>
            <span className="sess-title">{s.title}</span>
          </button>
        ))}
        <NewSessionForm onCreate={(input) => void guard(() => api.createSession(input)).then(adopt)} />
      </nav>
      {sessionId ? (
        <SessionPane key={sessionId} sessionId={sessionId} guard={guard} error={error} />
      ) : (
        <main className="empty-main">
          {error && <p className="err">{error}</p>}
          <p className="muted">Lege links einen Einsatz an, zum Beispiel „Wochenmarkt Südstadt“.</p>
        </main>
      )}
    </div>
  );
}

function NewSessionForm({ onCreate }: { onCreate: (i: { title: string; date: string; place: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  if (!open) {
    return (
      <button className="sess add" onClick={() => setOpen(true)}>
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
    <form className="newsession" onSubmit={submit}>
      <input
        autoFocus
        placeholder="Titel"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Titel"
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Datum" />
      <div className="row">
        <button className="btn pri sm" type="submit">
          Anlegen
        </button>
        <button className="btn sm" type="button" onClick={() => setOpen(false)}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

export type Step = "collect" | "sync" | "review" | "export";

function SessionPane({ sessionId, guard, error }: { sessionId: string; guard: Guard; error: string | null }) {
  const [view, setView] = useState<SessionView | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void guard(() => api.getSession(sessionId)).then((v) => {
      if (!v) return;
      setView(v);
      setStep((s) => s ?? (v.rows.length ? "review" : "collect"));
    });
  }, [sessionId, guard]);

  if (!view || !step) return <main className="empty-main muted">Lade…</main>;

  const update = (p: Promise<SessionView | undefined>) => void p.then((v) => v && setView(v));
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
          ? "Referenz?"
          : view.proposals.length
            ? `${view.proposals.length} Vorschl.`
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
    { id: "export", n: 4, title: "Ausgeben", badge: null },
  ];
  const selectedRow = view.rows.find((r) => r.id === selected) ?? null;

  return (
    <>
      <main className="main">
        <header className="head">
          <div className="head-title">
            <span className="mono muted">{formatDay(view.session.date)}</span>
            <h1>{view.session.title}</h1>
            {view.session.place && <span className="muted">{view.session.place}</span>}
          </div>
          <div className="steps" role="tablist">
            {steps.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={step === s.id}
                className={`step ${step === s.id ? "on" : ""}`}
                onClick={() => setStep(s.id)}
              >
                <span className="step-n">{s.n}</span>
                {s.title}
                {s.badge && <span className={`badge ${s.warn ? "warn" : ""}`}>{s.badge}</span>}
              </button>
            ))}
          </div>
        </header>
        {error && <p className="err">{error}</p>}
        <div className="body">
          {step === "collect" && (
            <Collect
              view={view}
              guard={guard}
              onView={setView}
              selected={selected}
              onSelect={setSelected}
              onRename={(id, label) => update(guard(() => api.renameDevice(id, label)))}
              onNext={() => setStep("sync")}
            />
          )}
          {step === "sync" && (
            <Sync
              view={view}
              guard={guard}
              onView={setView}
              onReference={(id) => update(guard(() => api.setReference(id)))}
              onOffset={(id, ms) => update(guard(() => api.setDeviceOffset(id, ms)))}
              onNext={() => setStep("review")}
            />
          )}
          {step === "review" && <Review view={view} selected={selected} onSelect={setSelected} />}
          {step === "export" && <ExportPlaceholder view={view} />}
        </div>
      </main>
      <Inspector
        view={view}
        row={selectedRow}
        onClose={() => setSelected(null)}
        onDiaryNote={(id, clock) => update(guard(() => api.setDiaryNote(id, clock)))}
      />
    </>
  );
}

function ExportPlaceholder({ view }: { view: SessionView }) {
  return (
    <section className="panel narrow">
      <h2>Ausgeben</h2>
      <p>
        Hier entsteht das Dokument für MAXQDA: ein Dokument pro Einsatz, mit Zeitmarken, Episoden und den eingebetteten
        Tagebuchseiten und Fotos.
      </p>
      <p className="muted">
        Das genaue Format steht noch aus. Sobald dein Test in MAXQDA zeigt, welche Variante sich am besten importieren
        lässt, baue ich diesen Schritt.
      </p>
      <div className="facts">
        <div>
          <b>{view.rows.length}</b>
          <span>Quellen</span>
        </div>
        <div>
          <b>{view.episodes?.length ?? "–"}</b>
          <span>Episoden</span>
        </div>
        <div>
          <b>{view.rows.filter((r) => r.status === "ok").length}</b>
          <span>sicher verortet</span>
        </div>
      </div>
    </section>
  );
}
