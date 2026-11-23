/** Rückgängig und Wiederholen: Zustand der Knöpfe, Tastenkürzel und der Hinweis nach wichtigen Schritten. */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { HistoryTarget, ProjectInfo, SessionView } from "../../shared/api.ts";
import { useJump, type JumpTargets } from "../SearchDialog.tsx";
import type { Guard } from "../App.tsx";

const api = window.feldspur;

/** Schritte, nach denen ein Hinweis mit „Rückgängig“ erscheint: sie ersetzen die frühere Nachfrage. */
const NOTIFY = new Set([
  "Quelle entfernt",
  "Zeitbelege neu gelesen",
  "Bestätigungen entfernt",
  "Anker entfernt",
  "Anker gesetzt",
  "Anker geändert",
  "Vorschlag übernommen",
  "Lage bestätigt",
  "Zeitbeleg gelöscht",
  "Tagebucheintrag gelöscht",
  "Notiz gelöscht",
  "Geräte zusammengeführt",
  "Widerspruch entschieden",
  "Widerspruch neu entschieden",
  "Widersprüche entschieden",
  "Entscheidung zurückgenommen",
]);

/** Beschriftung des Löschschritts für einen Einsatz (wie in main/ipc/sessions.ts). */
export const SESSION_DELETED = "Einsatz gelöscht";

export interface HistoryState {
  undo: string | null;
  redo: string | null;
  serial: number;
}

/** Beschriftungen tragen oft einen Zusatz („Lage bestätigt: F-003“); gemeldet wird nach dem Teil vor dem Doppelpunkt. */
const notifies = (label: string) => NOTIFY.has(label.split(":")[0]!);

export interface Toast {
  text: string;
  /** Wo der rückgängig gemachte Schritt etwas geändert hat („Zeigen“). */
  target?: HistoryTarget | null;
  /** Was der Knopf im Hinweis tut: false = rückgängig, true = wiederholen. */
  redo: boolean;
  n: number;
  /** Nur zur Information, es gibt nichts rückgängig zu machen (kein Knopf). */
  info?: boolean;
}

/** Textfeld mit eigenem Rückgängig (Strg+Z bleibt dort beim Feld). */
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range"].includes(el.type);
}

/** Verlauf des Projekts: Zustand für die Knöpfe, Strg/⌘+Z, Hinweis nach wichtigen Schritten. */
export function useHistory(
  view: SessionView | null,
  sessionId: string,
  guard: Guard,
  setView: (v: SessionView) => void,
  onProject: (p: ProjectInfo) => void,
  /** Meldet jeden neu gelesenen Stand des Verlaufs nach außen (für den Hinweis nach dem Löschen eines Einsatzes). */
  onState?: (h: HistoryState) => void,
) {
  const [state, setState] = useState<HistoryState>({ undo: null, redo: null, serial: 0 });
  const report = useEffectEvent((h: HistoryState) => onState?.(h));
  const [toast, setToast] = useState<Toast | null>(null);
  const lastSerial = useRef<number | null>(null);
  /** Zusatz für den nächsten Hinweis (z. B. „Alle Stellen geprüft“), gesetzt vor der neuen Ansicht. */
  const pendingNote = useRef<string | null>(null);
  // Nach jeder Änderung der Ansicht nachsehen, ob ein neuer Schritt dazugekommen ist.
  useEffect(() => {
    const note = pendingNote.current;
    pendingNote.current = null;
    void api.historyState().then((h) => {
      setState(h);
      report(h);
      const before = lastSerial.current;
      lastSerial.current = h.serial;
      if (before !== null && h.serial > before && h.undo && notifies(h.undo))
        setToast({ text: note ? `${h.undo}. ${note}.` : h.undo, redo: false, n: h.serial });
    });
  }, [view]);
  const step = async (redo: boolean) => {
    const r = await guard(() => (redo ? api.redo(sessionId) : api.undo(sessionId)));
    if (!r) return;
    onProject(r.project);
    if (r.view) setView(r.view);
    else {
      const h = await api.historyState();
      setState(h);
      onState?.(h);
    }
    setToast(
      r.label
        ? {
            text: `${redo ? "Wiederholt" : "Rückgängig gemacht"}: ${r.label}`,
            redo: !redo,
            n: Date.now(),
            target: r.target,
          }
        : null,
    );
  };
  const stepNow = useEffectEvent((redo: boolean) => step(redo));
  // Strg/⌘+Z, Strg/⌘+Umschalt+Z und Strg+Y. In Textfeldern macht zuerst das Feld rückgängig; hat es nichts
  // mehr, geht es mit dem Projekt weiter. Ob das Feld etwas getan hat, zeigt sein „beforeinput“ (historyUndo).
  useEffect(() => {
    let fieldActed = false;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType === "historyUndo" || e.inputType === "historyRedo") fieldActed = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const redo = key === "y" || (key === "z" && e.shiftKey);
      if (key !== "z" && key !== "y") return;
      if (isEditable(document.activeElement)) {
        fieldActed = false;
        // Kurz warten: Unter macOS kommt das Rückgängig des Feldes über das Menü, also etwas später.
        setTimeout(() => {
          if (!fieldActed) void stepNow(redo);
        }, 60);
        return;
      }
      e.preventDefault();
      void stepNow(redo);
    };
    window.addEventListener("beforeinput", onBeforeInput, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeinput", onBeforeInput, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return {
    state,
    toast,
    step: (redo: boolean) => void step(redo),
    dismiss: () => setToast(null),
    note: (text: string) => {
      pendingNote.current = text;
    },
    /** Hinweis ohne Rückgängig, wenn ein Schritt nichts geändert hat. */
    info: (text: string) => setToast({ text, redo: false, n: Date.now(), info: true }),
  };
}

export function UndoToast({
  view,
  toast,
  onAction,
  onClose,
  ...targets
}: {
  view: SessionView;
  toast: Toast | null;
  onAction: (redo: boolean) => void;
  onClose: () => void;
} & JumpTargets) {
  const jump = useJump(view, targets);
  // Jeder neue Hinweis steht acht Sekunden, auch wenn die App zwischendurch neu zeichnet.
  const shown = toast?.n;
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (shown === undefined) return;
    const t = setTimeout(close, 8000);
    return () => clearTimeout(t);
  }, [shown]);
  if (!toast) return null;
  return (
    <div
      role="status"
      data-testid="undo-toast"
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-2 text-[0.92rem] text-panel shadow-lg dark:border dark:border-line-2 dark:bg-panel-2 dark:text-ink"
    >
      <span>{toast.text}</span>
      {!toast.info && (
        <button
          className="cursor-pointer font-semibold text-accent-soft underline-offset-2 hover:underline dark:text-accent"
          onClick={() => {
            onAction(toast.redo);
          }}
        >
          {toast.redo ? "Wiederholen" : "Rückgängig"}
        </button>
      )}
      {toast.target && (
        <button
          className="cursor-pointer font-semibold text-accent-soft underline-offset-2 hover:underline dark:text-accent"
          title="Dorthin springen, wo sich etwas geändert hat"
          onClick={() => {
            const t = toast.target!;
            const row = view.rows.find((r) => r.id === t.sourceId);
            jump({
              kind: t.kind,
              target: t.sourceId,
              atMs: t.atMs,
              clockMs: row?.startMs != null ? row.startMs + (t.atMs ?? 0) : null,
            });
          }}
        >
          Zeigen
        </button>
      )}
      <button className="cursor-pointer opacity-70 hover:opacity-100" aria-label="Hinweis ausblenden" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

/**
 * Hinweis nach dem Löschen eines Einsatzes. Er steht wie der UndoToast acht Sekunden und verschwindet sofort, sobald
 * der oberste Rückgängig-Schritt nicht mehr das Löschen ist: dann hat sich etwas anderes geändert, und an derselben
 * Stelle erscheint womöglich schon der UndoToast. `topUndo` ist undefined, solange noch kein Stand bekannt ist.
 */
export function DeletedToast({
  title,
  topUndo,
  onUndo,
  onClose,
}: {
  title: string;
  topUndo: string | null | undefined;
  onUndo: () => void;
  onClose: () => void;
}) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const t = setTimeout(close, 8000);
    return () => clearTimeout(t);
  }, []);
  const stale = topUndo !== undefined && topUndo !== SESSION_DELETED;
  useEffect(() => {
    if (stale) close();
  }, [stale]);
  if (stale) return null;
  return (
    <div
      role="status"
      data-testid="session-deleted"
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-2 text-[0.92rem] text-panel shadow-lg dark:border dark:border-line-2 dark:bg-panel-2 dark:text-ink"
    >
      <span>Einsatz „{title}“ gelöscht</span>
      <button
        className="cursor-pointer font-semibold text-accent-soft underline-offset-2 hover:underline dark:text-accent"
        onClick={onUndo}
      >
        Rückgängig
      </button>
      <button className="cursor-pointer opacity-70 hover:opacity-100" aria-label="Hinweis ausblenden" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

export function HistoryGlyph({ redo = false }: { redo?: boolean }) {
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
