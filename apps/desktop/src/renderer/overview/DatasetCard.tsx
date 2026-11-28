/**
 * Karte „Angaben zum Datensatz“ in der Übersicht (Issue #206): einmal fürs Projekt eintragen, jede Ausgabe nennt sie in
 * der LIESMICH, im Kopf von Einsatztranskript und Viewer und, auf Wunsch, in den Metadaten (RO-Crate). Ein Einsatz kann
 * einzelne Felder in seinen Einsatzdaten überschreiben. Alles ist freiwillig; vorbelegt sind nur Titel und
 * Urheber*innen, und zwar als Hinweis am Feld, nicht als Eintrag.
 *
 * Gespeichert wird erst mit „Speichern“, als ein Schritt für Rückgängig (`setProjectDataset`).
 */
import { useState } from "react";
import type { DatasetInfo } from "@feldspur/core/model";
import { cleanDataset } from "@feldspur/media/dataset";
import { DatasetFields } from "../dataset/DatasetFields.tsx";
import { Button, cx, Panel } from "../ui.tsx";

const api = window.feldspur;

/** Gleiche Angaben, wenn nach dem Bereinigen dieselben Felder dasselbe sagen. */
const same = (a: DatasetInfo, b: DatasetInfo) => JSON.stringify(cleanDataset(a)) === JSON.stringify(cleanDataset(b));

export function DatasetCard({
  saved,
  researchers,
  projectName,
  onSaved,
}: {
  /** Die gespeicherten Angaben des Projekts. */
  saved: DatasetInfo;
  /** Forschende an den Geräten: Vorschläge für „Urheber*innen“. */
  researchers: string[];
  /** Name des Projekts: Vorschlag für den Titel, solange keiner eingetragen ist. */
  projectName: string;
  onSaved: (d: DatasetInfo) => void;
}) {
  const [draft, setDraft] = useState<DatasetInfo>(saved);
  const [status, setStatus] = useState<"saved" | "failed" | null>(null);
  // Zählt die Speicherungen: Nach jeder leuchtet die Vorschau kurz auf.
  const [settled, setSettled] = useState(0);
  const changed = !same(draft, saved);
  const firstUse = Object.keys(cleanDataset(saved)).length === 0;
  const save = () =>
    void api.setProjectDataset(draft).then(
      (d) => {
        setDraft(d);
        onSaved(d);
        setStatus("saved");
        setSettled((n) => n + 1);
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
        <div className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-56 flex-[1_1_0%]">
            <h2 className="text-[1.05rem] font-semibold">Angaben zum Datensatz</h2>
            <p className="mt-1 max-w-[70ch] text-[0.88rem] text-muted">
              Stehen in jeder Ausgabe des Projekts: in der LIESMICH, im Kopf von Einsatztranskript und Viewer und in den
              Metadaten (RO-Crate). Alles ist freiwillig. Ein Einsatz kann einzelne Felder in seinen Einsatzdaten
              überschreiben.
              {/* Beim ersten Mal: ein leichter Einstieg statt acht gleich wichtiger Felder. */}
              {firstUse && " Für den Anfang genügen ein Titel und die Urheber*innen; der Rest kann später folgen."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              role="status"
              className={cx(
                "inline-flex items-center gap-1.5 text-[0.9rem]",
                status === "failed" ? "text-bad" : "text-good",
              )}
            >
              {status === "saved" && !changed && (
                <>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="m3 8.5 3.2 3.2L13 4.8" />
                  </svg>
                  Gespeichert
                </>
              )}
              {status === "failed" && "Speichern hat nicht geklappt."}
            </span>
            {/* Verwerfen gibt es nur, solange es etwas zu verwerfen gibt. */}
            {changed && (
              <Button variant="ghost" type="button" onClick={() => setDraft(saved)}>
                Verwerfen
              </Button>
            )}
            <Button variant="primary" type="submit" disabled={!changed}>
              Speichern
            </Button>
          </div>
        </div>
        <DatasetFields
          value={draft}
          onChange={(d) => {
            setStatus(null);
            setDraft(d);
          }}
          researchers={researchers}
          titleSuggestion={projectName}
          settled={settled}
        />
      </form>
    </Panel>
  );
}
