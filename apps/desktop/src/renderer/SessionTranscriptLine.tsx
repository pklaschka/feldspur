/**
 * Eine Zeile der Einsatztranskript-Vorschau, gesetzt wie im .docx: Uhrzeit grau, Überschrift fett in der Farbe
 * ihrer Art, Zwischentafeln kursiv, vor Episoden etwas Abstand.
 */
import type { SessionTranscriptPreviewEntry } from "../shared/api.ts";

/** Feste Klassennamen, damit Tailwind sie findet. Ohne Eintrag: Textfarbe. */
const HEAD_CLASS: Partial<Record<SessionTranscriptPreviewEntry["kind"], string>> = {
  card: "text-st-card",
  episode: "text-st-episode",
  start: "text-st-start",
  photo: "text-st-photo",
  diary: "text-st-diary",
  sync: "text-st-sync",
};

export function SessionTranscriptLine({ entry: e }: { entry: SessionTranscriptPreviewEntry }) {
  const line = e.kind === "line";
  return (
    <li
      className={`border-b border-line/60 py-1 break-words text-pretty ${e.kind === "episode" ? "pt-3" : ""}`}
      data-kind={e.kind}
    >
      <span className="text-ink">{e.stamp}</span>{" "}
      {e.clock && <span className="text-st-clock">Uhrzeit {e.clock} · </span>}
      {e.head && (
        <span className={`${line ? "" : "font-semibold"} ${HEAD_CLASS[e.kind] ?? ""}`}>
          {e.head}
          {line ? " · " : ": "}
        </span>
      )}
      <span className={`whitespace-pre-line ${e.kind === "card" ? "italic" : ""}`}>{e.body}</span>
    </li>
  );
}
