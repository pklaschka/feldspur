import type { SessionTranscriptPreview } from "../../shared/api.ts";
import { SessionTranscriptLine } from "../SessionTranscriptLine.tsx";
import { Panel } from "../ui.tsx";

/** Vorschau des Einsatztranskripts: Kontext zuerst, dann die Chronologie, wie sie ausgegeben wird. */
export function TranscriptPreview({ preview }: { preview: SessionTranscriptPreview | null }) {
  return (
    <Panel className="min-w-0">
      <h3 className="mb-2 text-[1rem] font-semibold">Vorschau des Einsatztranskripts</h3>
      <ol
        className="max-h-[calc(100vh-16rem)] overflow-y-auto font-serif text-[0.92rem] leading-relaxed text-ink-2"
        data-testid="session-transcript-preview"
      >
        {!!preview?.context.length && (
          <>
            <li className="pb-1 font-sans font-semibold text-ink">Kontext</li>
            <li className="pb-1 text-[0.85rem] italic">
              Diese Stücke gehören nicht in die Chronologie und haben keine Zeitmarke.
            </li>
            {preview.context.map((c) => (
              <li key={c.key} className="border-b border-line/60 py-1 break-words" data-kind="context">
                <span className="font-semibold text-st-episode">{c.head}</span>
                <span className="text-st-clock">{c.details}</span>
                {c.body && <span className="block whitespace-pre-line">{c.body}</span>}
              </li>
            ))}
            <li className="pt-3 pb-1 font-sans font-semibold text-ink">Chronologie</li>
          </>
        )}
        {preview?.entries.map((e, i) => (
          <SessionTranscriptLine key={i} entry={e} />
        ))}
      </ol>
    </Panel>
  );
}
