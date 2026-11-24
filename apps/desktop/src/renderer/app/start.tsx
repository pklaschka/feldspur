/**
 * Bausteine für `App.tsx`: App-Symbol (Startbildschirm und Kopf der Einsatzliste) und das Formular für einen neuen
 * Einsatz (in der Einsatzliste und groß im leeren Projekt).
 */
import iconUrl from "../../../../../packaging/icon.svg?url";
import { useState, type FormEvent } from "react";
import { localDate } from "../format.ts";
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
 */
export function NewSessionForm({
  onCreate,
  hero,
  onRequestOpen,
}: {
  onCreate: (i: NewSession) => void;
  hero?: boolean;
  onRequestOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => localDate());
  const [place, setPlace] = useState("");
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
