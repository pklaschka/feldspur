/**
 * Kasten „Kontext“ in der Detailleiste (Issue #108): Titel, Entstanden, Erwähnt in, Stelle i von n und der Weg
 * zurück in die Chronologie. Bei Text ohne Scan auch der Text selbst.
 */
import type { ContextRow, SessionView } from "../../shared/api.ts";
import { clock } from "../format.ts";
import { useDraft } from "../hooks.ts";
import type { ApplyView } from "../Notes.tsx";
import { Button, CloseButton, ContextMark } from "../ui.tsx";
import { ContextThumb } from "./parts.tsx";

const api = window.feldspur;

/** Was „Zurück in die Chronologie“ bewirkt. */
function returnText(c: ContextRow): string {
  if (c.wouldStartMs !== null)
    return `Liegt dann wieder bei ${clock(c.wouldStartMs)}${c.wouldStartBasis ? ` (${c.wouldStartBasis})` : ""}.`;
  return "Hat keine Uhrzeit und landet dann unter „Ohne Uhrzeit“.";
}

export function ContextPanel({
  c,
  view,
  apply,
  onOpenDiary,
  onClose,
  standalone = false,
}: {
  c: ContextRow;
  view: SessionView;
  apply: ApplyView;
  onOpenDiary: (pageId: string) => void;
  onClose?: () => void;
  /** Eigener Kopf (Kontext-Eintrag oder Text ohne Scan), sonst steht der Kasten unter dem Kopf einer Quelle. */
  standalone?: boolean;
}) {
  const [title, setTitle] = useDraft(c.title, c.key);
  const [made, setMade] = useDraft(c.made, c.key);
  const [text, setText] = useDraft(c.text, c.key);
  const n = view.context.length;
  const move = (to: number) => apply(() => api.moveContext(c.key, to));
  const refsHere = view.diary.filter((e) => e.refs.includes(c.key)).length;

  return (
    <section data-testid="context-panel">
      {standalone && (
        <div className="flex items-start gap-2.5" data-testid="inspector-head">
          <ContextThumb c={c} className="h-12 w-14" />
          <div className="min-w-0">
            <b>{c.name}</b>
            <div className="truncate text-[0.86rem] text-ink-2">{c.find}</div>
          </div>
          <span className="flex-1" />
          {onClose && (
            <span className="-mt-1 -mr-1.5 flex">
              <CloseButton onClick={onClose} />
            </span>
          )}
        </div>
      )}
      <div className="mt-3.5 rounded-lg border border-line bg-sunken/60 p-3">
        <h3 className="inline-flex items-center gap-1.5 font-semibold">
          <ContextMark decorative />
          Kontext
        </h3>
        <p className="mt-0.5 text-[0.85rem] text-muted">Steht ohne Zeitmarke am Anfang des Einsatztranskripts.</p>
        <label className="mt-2.5 grid gap-0.5 text-[0.9rem]">
          <span className="text-muted">Titel</span>
          <input
            value={title}
            placeholder={c.find}
            aria-label="Titel des Kontextstücks"
            data-testid="context-title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() !== c.title && apply(() => api.setContextDetails(c.key, { title }))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
        <label className="mt-2 grid gap-0.5 text-[0.9rem]">
          <span className="text-muted">Entstanden (optional)</span>
          <input
            value={made}
            placeholder="z. B. vor dem Einsatz"
            aria-label="Entstanden"
            onChange={(e) => setMade(e.target.value)}
            onBlur={() => made.trim() !== c.made && apply(() => api.setContextDetails(c.key, { made }))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
        {c.textEditable && c.entryId && (
          <label className="mt-2 grid gap-0.5 text-[0.9rem]">
            <span className="text-muted">Text</span>
            <textarea
              className="min-h-32 rounded-md border border-line-2 bg-panel px-2 py-1 leading-relaxed"
              value={text}
              placeholder="Zusammenfassung, Liste oder Notiz, wie sie im Dokument stehen soll"
              aria-label="Text des Kontextstücks"
              data-testid="context-text"
              onChange={(e) => setText(e.target.value)}
              onBlur={() => text !== c.text && apply(() => api.patchDiaryEntry(c.entryId!, { fullText: text }))}
            />
          </label>
        )}
        {!c.textEditable && c.text && (
          <p className="mt-2 line-clamp-4 text-[0.86rem] whitespace-pre-line text-ink-2">{c.text}</p>
        )}
        {c.notedAt && <p className="mt-2 text-[0.85rem] text-muted">notiert {c.notedAt}</p>}

        <div className="mt-2.5 text-[0.9rem]">
          <span className="text-muted">Erwähnt in: </span>
          {c.mentionedBy.length ? (
            c.mentionedBy.map((m, i) => (
              <span key={m.entryId}>
                {i > 0 && ", "}
                <Button
                  variant="link"
                  onClick={() => m.pageId && onOpenDiary(m.pageId)}
                  disabled={!m.pageId}
                  title="Eintrag im Tagebuch öffnen"
                >
                  {m.notedAt} · Eintrag {m.number}
                </Button>
              </span>
            ))
          ) : (
            <span className="text-muted">–</span>
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-2 text-[0.9rem]" data-testid="context-position">
          <span>
            Stelle {c.position} von {n}
          </span>
          {n > 1 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={c.position <= 1}
                aria-label={`${c.name} weiter nach vorn`}
                title="weiter nach vorn"
                onClick={() => move(c.position - 1)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={c.position >= n}
                aria-label={`${c.name} weiter nach hinten`}
                title="weiter nach hinten"
                onClick={() => move(c.position + 1)}
              >
                ↓
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-2.5">
        {c.canReturn ? (
          <>
            <Button size="sm" onClick={() => apply(() => api.setContext(c.key, false))} data-testid="context-return">
              Zurück in die Chronologie
            </Button>
            <p className="mt-1 text-[0.85rem] text-muted">
              {returnText(c)}
              {refsHere > 0 && ` ${refsHere === 1 ? "Ein Verweis ruht" : `${refsHere} Verweise ruhen`} dann.`}
            </p>
          </>
        ) : (
          c.entryId && (
            <Button
              size="sm"
              variant="link"
              className="text-bad"
              onClick={() => apply(() => api.deleteDiaryEntry(c.entryId!))}
            >
              Text löschen
            </Button>
          )
        )}
        {c.entryId && c.thumb && (
          <Button size="sm" variant="link" className="ml-3" onClick={() => onOpenDiary(c.thumb!.sourceId)}>
            Im Tagebuch öffnen
          </Button>
        )}
      </div>
    </section>
  );
}
