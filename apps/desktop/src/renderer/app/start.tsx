/** Startbildschirm: App-Symbol und erster Einsatz. */
import iconUrl from "../../../../../packaging/icon.svg?url";
import { useState, type FormEvent } from "react";
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

export function NewSessionForm({
  onCreate,
}: {
  onCreate: (i: { title: string; date: string; place: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  if (!open) {
    return (
      <button
        className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-rail-muted hover:bg-rail-hover hover:text-rail-ink"
        onClick={() => setOpen(true)}
      >
        + neuer Einsatz
      </button>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), date, place: "" });
    setOpen(false);
    setTitle("");
  };
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
