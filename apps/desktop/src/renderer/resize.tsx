/**
 * Seitenleisten in der Breite verstellbar: Griff am Rand ziehen, Pfeiltasten oder Doppelklick
 * (zurück auf Standard). Die Breiten merkt sich die App auf diesem Rechner.
 */
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "./ui.tsx";

export interface PaneWidth {
  width: number;
  set: (w: number) => void;
  reset: () => void;
  min: number;
  max: number;
}

export function usePaneWidth(key: string, initial: number, min: number, max: number): PaneWidth {
  const clamp = (w: number) => Math.round(Math.max(min, Math.min(max, w)));
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`feldspur.breite.${key}`));
      return v ? clamp(v) : initial;
    } catch {
      return initial;
    }
  });
  const set = (w: number) => {
    const v = clamp(w);
    setWidth(v);
    try {
      localStorage.setItem(`feldspur.breite.${key}`, String(v));
    } catch {
      // Ohne Speicher gilt die Breite nur bis zum Neustart.
    }
  };
  return { width, set, reset: () => set(initial), min, max };
}

/**
 * Griff auf einer senkrechten Kante. side: auf welcher Seite die Leiste liegt; rechts heißt
 * Ziehen nach links verbreitert sie.
 */
export function ResizeHandle({
  pane,
  side,
  label,
  left,
}: {
  pane: PaneWidth;
  side: "left" | "right";
  label: string;
  /** Lage des Griffs (Mitte) von links. */
  left: string;
}) {
  const [drag, setDrag] = useState<{ x: number; w: number } | null>(null);
  const dir = side === "left" ? 1 : -1;
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: e.clientX, w: pane.width });
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) pane.set(drag.w + dir * (e.clientX - drag.x));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") pane.set(pane.width - dir * step);
    else if (e.key === "ArrowRight") pane.set(pane.width + dir * step);
    else if (e.key === "Home") pane.set(pane.min);
    else if (e.key === "End") pane.set(pane.max);
    else return;
    e.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={pane.width}
      aria-valuemin={pane.min}
      aria-valuemax={pane.max}
      tabIndex={0}
      title={`${label} (ziehen; Doppelklick: Standardbreite)`}
      className="group absolute inset-y-0 z-20 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none"
      style={{ left }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={pane.reset}
      onKeyDown={onKey}
    >
      <span
        className={cx(
          "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover:bg-accent group-focus-visible:bg-accent",
          drag && "bg-accent",
        )}
      />
    </div>
  );
}
