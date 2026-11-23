/**
 * Einsatzdaten bearbeiten: Titel, Datum, Ort, Zeitzone, Bezugszeitraum fürs Tagebuch
 * und freie Zusatzfelder für den Quellennachweis (z. B. DOI, Projektnummer). Von hier lässt sich der Einsatz auch
 * löschen (mit Nachfrage).
 */
import { AlertDialog, Dialog } from "radix-ui";
import { useState, type FormEvent } from "react";
import type { SessionPatch, SessionView } from "../shared/api.ts";
import { Button, CloseButton, ErrorBanner } from "./ui.tsx";
import { TIME_ZONES } from "./timeZones.ts";

const label = "grid gap-1 text-[0.9rem] font-medium";
const hint = "text-[0.82rem] font-normal text-muted";

export function SessionDetails({
  view,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  view: SessionView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Liefert true, wenn gespeichert wurde. */
  onSave: (patch: SessionPatch) => Promise<boolean>;
  /** Einsatz löschen (nach der Nachfrage). */
  onDelete: () => void;
}) {
  const s = view.session;
  const [title, setTitle] = useState(s.title);
  const [date, setDate] = useState(s.date);
  const [place, setPlace] = useState(s.place);
  const [timeZone, setTimeZone] = useState(s.timeZone);
  const [lookback, setLookback] = useState(String(view.diaryLookbackMin));
  const [extra, setExtra] = useState<[string, string][]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Beim Öffnen mit den gespeicherten Angaben beginnen; spätere Änderungen von außen nicht ins Formular holen.
  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setTitle(s.title);
      setDate(s.date);
      setPlace(s.place);
      setTimeZone(s.timeZone);
      setLookback(String(view.diaryLookbackMin));
      setExtra(Object.entries(s.extra));
    }
  }

  const dateMoves = date !== s.date;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await onSave({
      title,
      date,
      place,
      timeZone,
      diaryLookbackMin: Number(lookback.replace(",", ".")),
      extra: Object.fromEntries(extra.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v.trim()])),
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(560px,92vw)] -translate-1/2 overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-2xl"
          aria-describedby={undefined}
          data-testid="session-details"
        >
          <div className="mb-4 flex items-center">
            <Dialog.Title className="text-base font-semibold">Einsatzdaten</Dialog.Title>
            <span className="flex-1" />
            <CloseButton onClick={() => onOpenChange(false)} />
          </div>
          <ErrorBanner dialog className="mb-3" />
          <form className="grid gap-3.5" onSubmit={(e) => void submit(e)}>
            <label className={label}>
              Titel
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Datum
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              <label className={label}>
                Ort
                <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="z. B. Marktplatz" />
              </label>
            </div>
            {dateMoves && (
              <p className="rounded-md bg-warn-soft px-3 py-2 text-[0.86rem] text-warn">
                Von Hand eingetragene Uhrzeiten und Notierzeiten im Tagebuch wandern mit auf den neuen Tag. Zeiten aus
                Dateien bleiben, wie sie sind.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Zeitzone
                <input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} list="feldspur-zones" required />
                <datalist id="feldspur-zones">
                  {TIME_ZONES.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
                <span className={hint}>Um Zeitstempel in UTC in Ortszeit umzurechnen.</span>
              </label>
              <label className={label}>
                Bezugszeitraum Tagebuch
                <span className="flex items-center gap-2">
                  <input
                    className="w-24"
                    inputMode="numeric"
                    value={lookback}
                    onChange={(e) => setLookback(e.target.value)}
                  />
                  <span className="font-normal">Minuten</span>
                </span>
                <span className={hint}>So weit reicht ein Eintrag vor die Notierzeit zurück.</span>
              </label>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[0.9rem] font-medium">Weitere Angaben</legend>
              <p className={hint}>Für den Quellennachweis, z. B. DOI oder Projektnummer.</p>
              {extra.map(([k, v], i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="w-40"
                    aria-label="Feld"
                    placeholder="Feld"
                    value={k}
                    onChange={(e) => setExtra(extra.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))}
                  />
                  <input
                    className="min-w-0 flex-1"
                    aria-label={`Wert für ${k || "Feld"}`}
                    placeholder="Wert"
                    value={v}
                    onChange={(e) => setExtra(extra.map((x, j) => (j === i ? [x[0], e.target.value] : x)))}
                  />
                  <CloseButton
                    label={`${k || "Feld"} entfernen`}
                    onClick={() => setExtra(extra.filter((_, j) => j !== i))}
                  />
                </div>
              ))}
              <div>
                <Button size="sm" type="button" onClick={() => setExtra([...extra, ["", ""]])}>
                  + Feld
                </Button>
              </div>
            </fieldset>
            <div className="mt-1 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                className="mr-auto px-2.5 text-bad"
                onClick={() => setConfirmDelete(true)}
              >
                Einsatz löschen…
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Abbrechen
              </Button>
              <Button variant="primary" type="submit">
                Speichern
              </Button>
            </div>
          </form>
          <DeleteConfirm
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={s.title}
            sources={view.rows.length}
            onConfirm={() => {
              onOpenChange(false);
              onDelete();
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Nachfrage vor dem Löschen: was verschwindet, was bleibt. */
function DeleteConfirm({
  open,
  onOpenChange,
  title,
  sources,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  sources: number;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,90vw)] -translate-1/2 rounded-xl border border-line bg-panel p-5 shadow-xl"
          data-testid="delete-session"
        >
          <AlertDialog.Title className="font-semibold">Einsatz „{title}“ löschen?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[0.88rem] text-ink-2">
            {sources === 0
              ? "Der Einsatz hat keine Quellen."
              : `${sources === 1 ? "Die eine Quelle" : `Alle ${sources} Quellen`} mit Zeitbelegen, Ankern, Tagebucheinträgen, Mitschrift und Notizen ${sources === 1 ? "wird" : "werden"} aus dem Projekt genommen.`}{" "}
            Originaldateien und frühere Ausgaben bleiben erhalten. Rückgängig machen lässt es sich danach, solange das
            Projekt offen ist und du nichts Neues einsammelst oder analysierst.
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button>Abbrechen</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="primary" onClick={onConfirm}>
                Einsatz löschen
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
