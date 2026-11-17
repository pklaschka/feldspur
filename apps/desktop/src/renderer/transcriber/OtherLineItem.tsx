import type { OtherLine } from "./items.ts";
import { At } from "./Line.tsx";

/** Zeile aus einer anderen Spur: nur lesen; Klick auf die Zeit spult hier, auf das Kurzzeichen öffnet dort. */
export function OtherLineItem({
  atMs,
  line,
  startMs,
  onSeek,
  onOpen,
}: {
  atMs: number;
  line: OtherLine;
  startMs: number | null;
  onSeek: (ms: number) => void;
  onOpen: (line: OtherLine) => void;
}) {
  return (
    <li
      className="my-0.5 flex items-start gap-3 rounded-md bg-panel-2 px-2 py-0.5 text-ink-2"
      data-testid="other-line"
      title={`Aus der Mitschrift von ${line.label}, nur lesen`}
    >
      <button
        className="w-36 flex-none cursor-pointer pt-1 text-left font-mono text-[0.85rem] hover:text-accent"
        onClick={() => onSeek(atMs)}
        title="Hierhin springen"
      >
        <At ms={atMs} startMs={startMs} />
      </button>
      <button
        className="w-14 flex-none cursor-pointer truncate pt-1 text-left font-mono text-[0.85rem] font-medium hover:text-accent"
        onClick={() => onOpen(line)}
        title={`In ${line.label} mitschreiben (an dieser Stelle)`}
      >
        {line.label}
      </button>
      <span className="min-w-0 flex-1 py-1 text-[0.9rem] break-words">
        {line.speaker && <span className="mr-1.5 font-mono font-medium">{line.speaker}:</span>}
        {line.text}
      </span>
    </li>
  );
}
