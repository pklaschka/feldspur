/**
 * Dateien, die neben einer Ablagefläche landen: Chromium würde die Datei sonst öffnen (das Hauptfenster
 * blockt das Navigieren zusätzlich), und es passierte sichtbar nichts. Stattdessen zeigt der Zeiger
 * „hier nicht ablegen“, und ein Hinweis sagt, wo Dateien hingehören.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";

/** Elemente mit diesem Attribut nehmen Dateien selbst an (z. B. „Einsammeln“). */
export const DROP_ZONE_ATTR = "data-dropzone";

function isFileDrag(e: DragEvent): boolean {
  return !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
}

function inDropZone(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`[${DROP_ZONE_ATTR}]`);
}

/**
 * Fängt Datei-Ziehen außerhalb der Ablageflächen ab: kein Öffnen der Datei, Zeiger „nicht ablegen“,
 * und `onStray` beim Hineinziehen und beim (trotzdem ausgelösten) Ablegen. Gibt das Abmelden zurück.
 */
export function installStrayDropGuard(target: EventTarget, onStray: () => void): () => void {
  const handle = (e: Event) => {
    const d = e as DragEvent;
    if (!isFileDrag(d) || inDropZone(d.target)) return;
    d.preventDefault();
    if (d.type === "drop") onStray();
    else {
      d.dataTransfer!.dropEffect = "none";
      if (d.type === "dragenter") onStray();
    }
  };
  const types = ["dragenter", "dragover", "drop"] as const;
  for (const t of types) target.addEventListener(t, handle);
  return () => {
    for (const t of types) target.removeEventListener(t, handle);
  };
}

/** Zählt hoch, sobald Dateien neben einer Ablagefläche gezogen werden (höchstens einmal je Sekunde). */
export function useStrayDrop(): number {
  const [n, setN] = useState(0);
  const last = useRef(0);
  useEffect(
    () =>
      installStrayDropGuard(document, () => {
        const now = Date.now();
        if (now - last.current < 1000) return;
        last.current = now;
        setN((x) => x + 1);
      }),
    [],
  );
  return n;
}

/** Hinweis unten mittig, im Stil des Rückgängig-Hinweises; verschwindet nach acht Sekunden. */
export function StrayDropHint({
  n,
  text,
  action,
  onAction,
}: {
  /** Zähler aus `useStrayDrop`; 0 heißt: nichts zeigen. */
  n: number;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  const [closed, setClosed] = useState(0);
  const close = useEffectEvent(() => setClosed(n));
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(close, 8000);
    return () => clearTimeout(t);
  }, [n]);
  if (!n || closed === n) return null;
  return (
    <div
      role="status"
      data-testid="stray-drop-hint"
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-2 text-[0.92rem] text-panel shadow-lg dark:border dark:border-line-2 dark:bg-panel-2 dark:text-ink"
    >
      <span>{text}</span>
      {action && onAction && (
        <button
          className="cursor-pointer font-semibold text-accent-soft underline-offset-2 hover:underline dark:text-accent"
          onClick={() => {
            setClosed(n);
            onAction();
          }}
        >
          {action}
        </button>
      )}
      <button
        className="cursor-pointer opacity-70 hover:opacity-100"
        aria-label="Hinweis ausblenden"
        onClick={() => setClosed(n)}
      >
        ×
      </button>
    </div>
  );
}
