/**
 * Eine Zeile der Einsatztranskript-Vorschau, gesetzt wie im .docx: Uhrzeit grau, Überschrift fett in der Farbe
 * ihrer Art, Zwischentafeln kursiv, vor Episoden etwas Abstand.
 *
 * Gehört zum Schritt „Ausgeben“: `apps/desktop/src/renderer/export/TranscriptPreview.tsx` setzt daraus die Vorschau
 * zusammen. Die Zeilen kommen schon in Teile zerlegt aus dem Hauptprozess (`previewExport`,
 * `SessionTranscriptPreviewEntry` in `apps/desktop/src/shared/api.ts`); hier wird nur noch gesetzt.
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

/**
 * Bei Zeilen der Mitschrift (`kind === "line"`) ist der Kopf das Kurzzeichen der Aufnahme: nicht fett und mit „·“
 * abgesetzt. Er fehlt, wenn nur eine Aufnahme Mitschrift hat (`packages/media/src/session-transcript.ts`).
 */
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
