/**
 * Tagebuchseite in der Detailleiste (`apps/desktop/src/renderer/Inspector.tsx`): Randnotiz und Überblick über die
 * Einträge. Abgetippt wird im Tagebuch-Editor (`apps/desktop/src/renderer/DiaryEditor.tsx`), den „Abtippen…“ öffnet.
 */
import type { DiaryEntryRow, SourceRow } from "../../shared/api.ts";
import { hm } from "../format.ts";
import { Button, Eyebrow } from "../ui.tsx";
import { useDraft } from "../hooks.ts";
import { ClockInput } from "../ClockField.tsx";

/** Randnotiz: die Uhrzeit am Seitenrand (Notierzeit). Aus ihr ergibt sich der Bezugszeitraum (`diaryWindow`). */
function DiaryNote({ row, onCommit }: { row: SourceRow; onCommit: (clock: string) => void }) {
  const [text, setText] = useDraft(row.diaryNote ?? "", row.id);
  const commit = (v: string) => v !== (row.diaryNote ?? "") && onCommit(v);
  return (
    <div className="mt-3.5 rounded-lg bg-k-diary/10 p-3">
      <label className="flex items-center gap-3">
        <span className="text-[0.78rem] font-semibold text-k-diary">Randnotiz</span>
        <ClockInput
          ariaLabel={`Randnotiz ${row.label}`}
          value={text}
          onChange={setText}
          onCommit={commit}
          advance={false}
        />
      </label>
      <p className="mt-1.5 text-[0.85rem] text-muted">
        {row.diaryWindow
          ? `Bezieht sich auf ${hm(row.diaryWindow.fromMs)}–${hm(row.diaryWindow.toMs)}. Notiert wird meist etwas später; der Zeitraum reicht deshalb zurück.`
          : "Uhrzeit, die am Rand der Seite steht. Daraus ergibt sich, auf welchen Zeitraum sich die Seite bezieht."}
      </p>
    </div>
  );
}

/** Tagebuchseite in der Detailleiste: Einträge im Überblick, schnelle Randnotiz bei höchstens einem Eintrag. */
export function DiaryPage({
  row,
  entries,
  onNote,
  onOpen,
}: {
  row: SourceRow;
  entries: DiaryEntryRow[];
  onNote: (clock: string) => void;
  onOpen: () => void;
}) {
  return (
    <>
      {entries.length <= 1 && <DiaryNote row={row} onCommit={onNote} />}
      <Eyebrow>Einträge auf dieser Seite</Eyebrow>
      {entries.length > 0 ? (
        <ul className="grid gap-1 text-[0.9rem]">
          {entries.map((e) => (
            <li key={e.id} className="flex gap-2">
              <b className="font-mono text-k-diary">{e.number}</b>
              <span className="font-mono text-muted">{e.notedAt ?? "–:–"}</span>
              <span className="truncate">
                {e.shortText || (e.mode === "scan" ? "nur Scan" : "noch nicht abgetippt")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.85rem] text-muted">Noch nicht abgetippt.</p>
      )}
      <Button variant="primary" size="sm" className="mt-2" onClick={onOpen}>
        Abtippen…
      </Button>
    </>
  );
}
