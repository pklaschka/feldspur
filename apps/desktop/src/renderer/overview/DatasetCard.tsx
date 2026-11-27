/**
 * Karte „Angaben zum Datensatz“ in der Übersicht (Issue #206): einmal fürs Projekt eintragen, jede Ausgabe nennt sie in
 * der LIESMICH und, auf Wunsch, in den Metadaten (RO-Crate). Ein Einsatz kann einzelne Felder in seinen Einsatzdaten
 * überschreiben. Alles ist freiwillig; vorbelegt sind nur Titel und Urheber*innen, und zwar als Platzhalter, nicht als
 * Eintrag.
 *
 * Gespeichert wird erst mit „Speichern“, als ein Schritt für Rückgängig (`setProjectDataset`).
 */
import { useState } from "react";
import type { DatasetInfo } from "@feldspur/core/model";
import { cleanDataset } from "@feldspur/media/dataset";
import { DatasetFields } from "../dataset/DatasetFields.tsx";
import { Button, Panel } from "../ui.tsx";

const api = window.feldspur;

/** Gleiche Angaben, wenn nach dem Bereinigen dieselben Felder dasselbe sagen. */
const same = (a: DatasetInfo, b: DatasetInfo) => JSON.stringify(cleanDataset(a)) === JSON.stringify(cleanDataset(b));

export function DatasetCard({
  saved,
  researchers,
  onSaved,
}: {
  /** Die gespeicherten Angaben des Projekts. */
  saved: DatasetInfo;
  /** Forschende an den Geräten: Vorbelegung für „Urheber*innen“. */
  researchers: string[];
  onSaved: (d: DatasetInfo) => void;
}) {
  const [draft, setDraft] = useState<DatasetInfo>(saved);
  const [status, setStatus] = useState<"saved" | "failed" | null>(null);
  const changed = !same(draft, saved);
  const save = () =>
    void api.setProjectDataset(draft).then(
      (d) => {
        setDraft(d);
        onSaved(d);
        setStatus("saved");
      },
      () => setStatus("failed"),
    );
  return (
    <Panel>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        data-testid="dataset-card"
      >
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-[1.05rem] font-semibold">Angaben zum Datensatz</h2>
          <span className="flex-1" />
          <span role="status" className={status === "failed" ? "text-[0.9rem] text-bad" : "text-[0.9rem] text-good"}>
            {status === "saved" && !changed && (
              <>
                <span aria-hidden>✓ </span>Gespeichert
              </>
            )}
            {status === "failed" && "Speichern hat nicht geklappt."}
          </span>
          <Button type="button" disabled={!changed} onClick={() => setDraft(saved)}>
            Verwerfen
          </Button>
          <Button variant="primary" type="submit" disabled={!changed}>
            Speichern
          </Button>
        </div>
        <p className="mb-4 max-w-[78ch] text-[0.88rem] text-muted">
          Gelten für jede Ausgabe dieses Projekts: in der LIESMICH und in den Metadaten (RO-Crate). Ein Einsatz kann
          einzelne Felder in seinen Einsatzdaten überschreiben. Alles ist freiwillig, leere Felder bleiben in der
          Ausgabe leer.
        </p>
        <DatasetFields
          value={draft}
          onChange={(d) => {
            setStatus(null);
            setDraft(d);
          }}
          placeholder={{
            title: "Ohne Titel heißt jede Ausgabe nach Einsatz und Datum",
            creators: researchers.length ? researchers.join("\n") : undefined,
          }}
        />
        {!draft.creators?.trim() && researchers.length > 0 && (
          <p className="mt-2 text-[0.82rem] text-muted">
            Ohne Eintrag gelten die Forschenden an den Geräten des jeweiligen Einsatzes als Urheber*innen.
          </p>
        )}
      </form>
    </Panel>
  );
}
