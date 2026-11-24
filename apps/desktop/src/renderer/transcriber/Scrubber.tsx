/** Übersichtsleiste über die ganze Aufnahme in „Mitschreiben“ (`apps/desktop/src/renderer/Transcriber.tsx`). */
import type { SourceRow, TranscriptRow } from "../../shared/api.ts";
import { positionText } from "../playback.tsx";
import { cx } from "../ui.tsx";
import type { WaveBand } from "../Waveform.tsx";
import type { Event } from "./items.ts";

/**
 * Schmale Leiste über die ganze Aufnahme: Zeilen als Striche, Ereignisse als Punkte, Notizen als
 * Bänder, der Ausschnitt der Waveform als Rahmen. Klick spult.
 */
export function Scrubber({
  row,
  pos,
  lines,
  events,
  bands,
  window: win,
  onSeek,
}: {
  row: SourceRow;
  /** Wiedergabestelle in ms. */
  pos: number;
  lines: TranscriptRow[];
  events: Event[];
  bands: WaveBand[];
  /** Ausschnitt, den die Waveform gerade zeigt. */
  window: { fromMs: number; toMs: number };
  onSeek: (ms: number) => void;
}) {
  const dur = row.durationMs ?? 0;
  if (!dur) return null;
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / dur) * 100))}%`;
  const width = (a: number, b: number) => `${Math.max(0.3, Math.min(100, ((b - a) / dur) * 100))}%`;
  return (
    <div
      className="relative mt-2 h-6 cursor-pointer overflow-hidden rounded bg-sunken"
      onClick={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - b.left) / b.width) * dur);
      }}
      role="slider"
      aria-label="Stelle in der Aufnahme"
      aria-valuemin={0}
      aria-valuemax={dur}
      aria-valuenow={pos}
      aria-valuetext={positionText(pos)}
      tabIndex={-1}
      data-testid="scrubber"
    >
      {bands.map((b, i) => (
        <span
          key={i}
          className={cx("absolute inset-y-0", b.tone === "good" ? "bg-good/15" : "bg-warn/25")}
          style={{ left: pct(b.fromMs), width: width(b.fromMs, b.toMs) }}
        />
      ))}
      <span
        className="absolute inset-y-0 border-x border-ink-2/40 bg-ink/5"
        style={{ left: pct(win.fromMs), width: width(win.fromMs, win.toMs) }}
      />
      {lines.map((l) => (
        <span key={l.id} className="absolute top-1 h-4 w-px bg-accent/60" style={{ left: pct(l.atMs) }} />
      ))}
      {events.map((e) => (
        <span
          key={e.key}
          className="absolute top-2 size-2 -translate-x-1 rounded-full bg-muted"
          style={{ left: pct(e.atMs) }}
        />
      ))}
      <span className="absolute top-0 h-6 w-0.5 bg-bad" style={{ left: pct(pos) }} />
    </div>
  );
}
