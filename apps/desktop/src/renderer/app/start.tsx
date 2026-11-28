/**
 * Bausteine für `App.tsx`: App-Symbol (Startbildschirm und Kopf der Einsatzliste), das Formular für einen neuen
 * Einsatz (in der Einsatzliste und groß im leeren Projekt) und der Leerzustand eines Projekts mit Vorschau.
 */
import iconUrl from "../../../../../packaging/icon.svg?url";
import { useEffect, useEffectEvent, useState, type FormEvent } from "react";
import { formatDay, localDate } from "../format.ts";
import { Button, cx } from "../ui.tsx";

/** Das App-Symbol (Feldmarker auf Notizpapier) mit Namen. */
export function Logo({ small }: { small?: boolean }) {
  return (
    <div
      className={cx("flex items-center gap-2.5 font-serif font-semibold", small ? "text-[1.2rem]" : "text-[1.9rem]")}
    >
      <img src={iconUrl} alt="" className={small ? "size-7" : "size-12"} />
      Feldspur
    </div>
  );
}

type NewSession = { title: string; date: string; place: string };

/** Id des Titelfelds der Hero-Fassung: die Leiste springt im Leerzustand dorthin. */
export const HERO_TITLE_ID = "new-session-title";

const fieldLabel = "grid gap-1 text-[0.9rem] font-medium";

/**
 * Formular für einen neuen Einsatz. Standard: eingeklappt in der Leiste (`+ neuer Einsatz`).
 * `hero`: gleich offen, mit beschrifteten Feldern, für den Leerzustand eines Projekts.
 * `onRequestOpen`: Die Leiste klappt dann nicht selbst auf, sondern meldet den Wunsch (Sprung zur Hero-Fassung).
 * `onDraft`: bekommt bei jeder Eingabe den Stand der Felder (für `SessionPreview` neben der Hero-Fassung).
 */
export function NewSessionForm({
  onCreate,
  hero,
  onRequestOpen,
  onDraft,
}: {
  onCreate: (i: NewSession) => void;
  hero?: boolean;
  onRequestOpen?: () => void;
  onDraft?: (d: NewSession) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => localDate());
  const [place, setPlace] = useState("");
  const draft = useEffectEvent((d: NewSession) => onDraft?.(d));
  useEffect(() => draft({ title, date, place }), [title, date, place]);
  if (!hero && !open) {
    return (
      <button
        className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-rail-muted hover:bg-rail-hover hover:text-rail-ink"
        onClick={() => (onRequestOpen ? onRequestOpen() : setOpen(true))}
      >
        + neuer Einsatz
      </button>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), date, place: place.trim() });
    setOpen(false);
    setTitle("");
    setPlace("");
  };
  if (hero) {
    return (
      <form className="mt-5 grid max-w-[28rem] gap-3.5" onSubmit={submit}>
        <label className={fieldLabel}>
          Titel
          <input
            id={HERO_TITLE_ID}
            autoFocus
            required
            placeholder="z. B. Wochenmarkt Südstadt"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            Datum
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className={fieldLabel}>
            Ort
            <input placeholder="z. B. Marktplatz" value={place} onChange={(e) => setPlace(e.target.value)} />
          </label>
        </div>
        <div>
          <Button variant="primary" type="submit">
            Einsatz anlegen
          </Button>
        </div>
      </form>
    );
  }
  return (
    <form className="grid gap-1.5 p-1.5 text-ink" onSubmit={submit}>
      <input
        autoFocus
        placeholder="Titel"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Titel"
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Datum" />
      <input placeholder="Ort (optional)" value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Ort" />
      <div className="flex gap-1.5">
        <Button variant="primary" size="sm" type="submit">
          Anlegen
        </Button>
        <Button size="sm" type="button" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

/** Die fünf Schritte mit je einem Halbsatz, wie sie die Vorschau des ersten Einsatzes ankündigt. */
const PREVIEW_STEPS = [
  ["Einsammeln", "Dateien des Tages hinzufügen"],
  ["Abgleichen", "Geräte auf eine Zeitachse bringen"],
  ["Durchsehen", "Lage jeder Aufnahme prüfen"],
  ["Ansehen", "Montage und Einsatztranskript vorab ansehen"],
  ["Ausgeben", "Einsatztranskript und Montagevideo erstellen"],
] as const;

/** Blasser Platzhalter für ein leeres Feld in der Vorschau. */
const pale = "text-muted/60";

/**
 * Vorschau neben dem Formular im leeren Projekt: So steht der Einsatz gleich in der Kopfzeile (`SessionPane.tsx`,
 * gleiche Schriften und Größen), darunter die fünf Schritte als Ausblick. Die Kopfzeile ist für Screenreader
 * verborgen, weil sie nur wiederholt, was in den Feldern steht.
 */
function SessionPreview({ draft }: { draft: NewSession }) {
  const title = draft.title.trim();
  const place = draft.place.trim();
  return (
    <section
      aria-label="Vorschau"
      data-testid="session-preview"
      className="min-w-0 rounded-xl border border-line bg-panel px-6 pt-5 pb-6 shadow-sm"
    >
      <p className="text-[0.85rem] text-muted">So steht der Einsatz dann oben</p>
      <div aria-hidden className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={cx("font-serif text-[1.05rem] italic", draft.date ? "text-muted" : pale)}>
          {draft.date ? formatDay(draft.date) : "TT.MM."}
        </span>
        <span className={cx("min-w-0 text-[1.6rem] leading-tight font-semibold break-words", !title && pale)}>
          {title || "Titel"}
        </span>
        <span className={cx("font-serif text-[1.05rem] italic", place ? "text-muted" : pale)}>{place || "Ort"}</span>
      </div>
      <ol className="mt-4 grid gap-2.5">
        {PREVIEW_STEPS.map(([name, what], i) => (
          <li key={name} className="flex items-baseline gap-2.5">
            <span
              aria-hidden
              className={cx(
                "grid size-[22px] flex-none translate-y-[-1px] place-items-center self-start rounded-full border font-serif text-[0.85rem]",
                i === 0 ? "border-accent bg-accent text-accent-ink" : "border-line-2 bg-panel text-muted",
              )}
            >
              {i + 1}
            </span>
            <span>
              <span className="font-semibold">{name}</span>
              <span className="text-muted"> · {what}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Leerzustand eines Projekts: Überschrift und Formular links, Vorschau rechts. Im schmalen Fenster rutscht die
 * Vorschau unter das Formular.
 */
export function FirstSession({ onCreate }: { onCreate: (i: NewSession) => void }) {
  const [draft, setDraft] = useState<NewSession>(() => ({ title: "", date: localDate(), place: "" }));
  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
      <div className="w-full max-w-[28rem]">
        <h2 className="mb-1 text-[1.4rem] font-semibold">Noch kein Einsatz</h2>
        <p className="text-muted">Ein Einsatz ist ein Tag im Feld.</p>
        <NewSessionForm hero onDraft={setDraft} onCreate={onCreate} />
      </div>
      <div className="max-w-[34rem] min-w-[min(100%,22rem)] flex-1">
        <SessionPreview draft={draft} />
      </div>
    </div>
  );
}
