/**
 * Gemeinsamer Wiedergabestand: welche Quelle an welcher Stelle steht, und
 * Spul-Wünsche von außen (Klick auf die Zeitachse). Die Wiedergabe selbst
 * läuft im Player der Detailleiste.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { formatDuration } from "@feldspur/core/time";

export interface Position {
  sourceId: string;
  atMs: number;
  playing: boolean;
}

interface Playback {
  position: Position | null;
  report: (p: Position | null) => void;
  /** Letzter Spul-Wunsch; `n` zählt hoch, damit derselbe Wunsch erneut greift. */
  seekRequest: { sourceId: string; atMs: number; n: number } | null;
  seek: (sourceId: string, atMs: number) => void;
}

const Ctx = createContext<Playback | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [position, report] = useState<Position | null>(null);
  const [seekRequest, setSeek] = useState<Playback["seekRequest"]>(null);
  const value = useMemo<Playback>(
    () => ({
      position,
      report,
      seekRequest,
      seek: (sourceId, atMs) => setSeek((s) => ({ sourceId, atMs, n: (s?.n ?? 0) + 1 })),
    }),
    [position, seekRequest],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayback(): Playback {
  const c = useContext(Ctx);
  if (!c) throw new Error("PlaybackProvider fehlt");
  return c;
}

/** Stelle als Text für Eingabefelder: "1:20.4". */
export function positionText(ms: number): string {
  const tenths = Math.floor((ms % 1000) / 100);
  return `${formatDuration(ms - (ms % 1000))}${tenths ? `.${tenths}` : ""}`;
}
