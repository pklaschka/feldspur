/** Rückgängig und Wiederholen: Zustand der Knöpfe, Tastenkürzel und der Hinweis nach wichtigen Schritten. */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { HistoryTarget, ProjectInfo, SessionView } from "../../shared/api.ts";
import { useJump, type JumpTargets } from "../SearchDialog.tsx";
import type { Guard } from "../App.tsx";

const api = window.feldspur;

/** Schritte, nach denen ein Hinweis mit „Rückgängig“ erscheint: sie ersetzen die frühere Nachfrage. */
export const NOTIFY = new Set([
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

export interface Toast {
  text: string;
  /** Wo der rückgängig gemachte Schritt etwas geändert hat („Zeigen“). */
  target?: HistoryTarget | null;
  /** Was der Knopf im Hinweis tut: false = rückgängig, true = wiederholen. */
  redo: boolean;
  n: number;
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
  return { state, toast, step: (redo: boolean) => void step(redo), dismiss: () => setToast(null) };
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
      <button
        className="cursor-pointer font-semibold text-accent-soft underline-offset-2 hover:underline dark:text-accent"
        onClick={() => {
          onAction(toast.redo);
        }}
      >
        {toast.redo ? "Wiederholen" : "Rückgängig"}
      </button>
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
