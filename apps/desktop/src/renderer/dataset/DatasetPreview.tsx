/**
 * Vorschau unter den Feldern der Angaben zum Datensatz: die Zeilen, wie sie im Kopf von Einsatztranskript und Viewer
 * stehen (`datasetLines` in `packages/media/src/dataset.ts`, dieselbe Funktion wie in der Ausgabe). In den
 * Einsatzdaten zeigt sie Projekt und Einsatz zusammen und kennzeichnet, was nur für diesen Einsatz gilt: So sieht man,
 * was ein Eintrag dort bewirkt. Nach dem Speichern liegen die Zeilen kurz salbeigrün hinterlegt (`settle-once` in
 * `styles.css`), wie eine gerückte Uhr im Schritt Abgleichen.
 */
import type { DatasetInfo } from "@feldspur/core/model";
import { cleanDataset, DATASET_FIELDS, datasetLines } from "@feldspur/media/dataset";
import { cx, Pill } from "../ui.tsx";
import { HINT } from "./parts.tsx";

export function DatasetPreview({
  value,
  project,
  settled = 0,
}: {
  /** Die Angaben im Formular, auch noch nicht gespeicherte. */
  value: DatasetInfo;
  /** In den Einsatzdaten: die Angaben des Projekts, über die sich die des Einsatzes legen. */
  project?: DatasetInfo;
  /** Zählt die Speicherungen; jede neue lässt die Zeilen einmal aufleuchten. */
  settled?: number;
}) {
  const own = cleanDataset(value);
  const base = cleanDataset(project);
  const lines = DATASET_FIELDS.flatMap(({ key }) => {
    const text = own[key] ?? base[key];
    const line = text ? datasetLines({ [key]: text })[0] : undefined;
    return line ? [{ key, label: line[0], text: line[1], onlyHere: !!project && !!own[key] }] : [];
  });
  if (!lines.length)
    return (
      <p className={HINT} data-testid="dataset-preview">
        {project
          ? "Weder im Projekt noch hier ist etwas eingetragen. Angaben fürs ganze Projekt trägst du in der Übersicht ein."
          : "Noch keine Angaben. Hier steht dann, wie sie im Kopf von Einsatztranskript und Viewer erscheinen."}
      </p>
    );
  return (
    <div className="grid gap-1.5" data-testid="dataset-preview">
      {/* Der Schlüssel zeichnet die Liste nach jedem Speichern neu, damit das Aufleuchten wieder anläuft. */}
      <dl key={settled} className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[0.9rem]">
        {lines.map((l) => (
          <div
            key={l.key}
            className={cx(
              "-mx-1.5 grid grid-cols-[9.5rem_minmax(0,1fr)] gap-x-3 rounded-md px-1.5 py-0.5",
              settled > 0 && "settle-once",
            )}
          >
            <dt className="text-muted">{l.label}</dt>
            <dd className="min-w-0 break-words">
              {l.text}
              {l.onlyHere && (
                <>
                  {" "}
                  <Pill tone="accent">nur dieser Einsatz</Pill>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className={HINT}>
        {project
          ? "Projekt und Einsatz zusammen: So stehen die Angaben in der Ausgabe dieses Einsatzes."
          : "So stehen die Angaben im Kopf von Einsatztranskript und Viewer; LIESMICH und Metadaten nennen dasselbe."}
      </p>
    </div>
  );
}
