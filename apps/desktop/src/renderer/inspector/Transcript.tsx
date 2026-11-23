/** Mitschrift in der Detailleiste: Stand und Import fertiger Transkripte. */
import { DropdownMenu } from "radix-ui";
import type { SessionView, SourceRow } from "../../shared/api.ts";
import { positionText } from "../playback.tsx";
import { Button } from "../ui.tsx";
import { useDraft } from "../hooks.ts";
import type { InspectorActions } from "./actions.ts";

/** „212 Zeilen übernommen, 3 hinter dem Ende der Aufnahme ausgelassen“. */
function importMessage(count: number, dropped: number): string {
  const text = `${count} ${count === 1 ? "Zeile" : "Zeilen"} übernommen`;
  return dropped > 0 ? `${text}, ${dropped} hinter dem Ende der Aufnahme ausgelassen` : text;
}

/** Fertiges Transkript (Whisper u. a.) übernehmen; gibt es schon Zeilen, ergänzen oder ersetzen. */
export function TranscriptImport({
  view,
  row,
  onImport,
}: {
  view: SessionView;
  row: SourceRow;
  onImport: InspectorActions["importTranscript"];
}) {
  // Meldung „übernommen“ gilt nur für die Quelle, bei der importiert wurde.
  const [done, setDone] = useDraft<string | null>(null, row.id);
  const has = view.transcript.some((l) => l.sourceId === row.id);
  const run = async (mode: "append" | "replace") => {
    const r = await onImport(row.id, mode);
    if (r) setDone(importMessage(r.count, r.dropped));
  };
  const trigger = "Transkript importieren…";
  return (
    <>
      {done && (
        <span className="self-center text-[0.8rem] text-good" role="status">
          {done}
        </span>
      )}
      {has ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm">{trigger}</Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-56 rounded-lg border border-line bg-panel p-1 shadow-lg"
            >
              {(
                [
                  ["append", "Zur Mitschrift hinzufügen…"],
                  ["replace", "Mitschrift ersetzen…"],
                ] as const
              ).map(([mode, label]) => (
                <DropdownMenu.Item
                  key={mode}
                  className="cursor-pointer rounded px-2.5 py-1.5 text-[0.9rem] outline-none data-[highlighted]:bg-accent-soft"
                  onSelect={() => void run(mode)}
                >
                  {label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : (
        <Button size="sm" onClick={() => void run("append")} title="SRT, VTT, JSON oder TSV, z. B. aus Whisper">
          {trigger}
        </Button>
      )}
    </>
  );
}

export function TranscriptSummary({ view, row }: { view: SessionView; row: SourceRow }) {
  const lines = view.transcript.filter((l) => l.sourceId === row.id);
  if (!lines.length) return null;
  const last = lines.at(-1)!;
  return (
    <p className="mt-1.5 text-[0.85rem] text-muted" data-testid="transcript-summary">
      Mitschrift: {lines.length} {lines.length === 1 ? "Zeile" : "Zeilen"}, bis {positionText(last.atMs)}
    </p>
  );
}
