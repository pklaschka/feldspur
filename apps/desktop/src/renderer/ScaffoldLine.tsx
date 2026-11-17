/**
 * Eine Zeile der Zeitgerüst-Vorschau, gesetzt wie im .docx: Uhrzeit grau, Überschrift fett in der Farbe
 * ihrer Art, Zwischentafeln kursiv, vor Episoden etwas Abstand.
 */
import type { ScaffoldPreviewEntry } from "../shared/api.ts";

/** Feste Klassennamen, damit Tailwind sie findet. Ohne Eintrag: Textfarbe. */
const HEAD_CLASS: Partial<Record<ScaffoldPreviewEntry["kind"], string>> = {
  card: "text-sc-card",
  episode: "text-sc-episode",
  start: "text-sc-start",
  photo: "text-sc-photo",
  diary: "text-sc-diary",
  sync: "text-sc-sync",
};

export function ScaffoldLine({ entry: e }: { entry: ScaffoldPreviewEntry }) {
  const line = e.kind === "line";
  return (
    <li
      className={`border-b border-line/60 py-1 break-words text-pretty ${e.kind === "episode" ? "pt-3" : ""}`}
      data-kind={e.kind}
    >
      <span className="text-ink">{e.stamp}</span>{" "}
      {e.clock && <span className="text-sc-clock">Uhrzeit {e.clock} · </span>}
      {e.head && (
        <span className={`${line ? "" : "font-semibold"} ${HEAD_CLASS[e.kind] ?? ""}`}>
          {e.head}
          {line ? " · " : ": "}
        </span>
      )}
      <span className={e.kind === "card" ? "italic" : ""}>{e.body}</span>
    </li>
  );
}
