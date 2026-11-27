/**
 * Die Felder der Angaben zum Datensatz (Issue #206), gemeinsam für die Übersicht (Angaben fürs Projekt,
 * `overview/DatasetCard.tsx`) und die Einsatzdaten (Angaben, die nur für einen Einsatz gelten, `SessionDetails.tsx`).
 * Welche Felder es gibt, steht in `packages/media/src/dataset.ts`; hier nur, wie sie aussehen.
 */
import { useId } from "react";
import type { DatasetInfo } from "@feldspur/core/model";
import { ACCESS_SUGGESTIONS, DATASET_FIELDS, LICENSE_SUGGESTIONS } from "@feldspur/media/dataset";
import { cx } from "../ui.tsx";

type Key = keyof DatasetInfo;

/** Hinweis unter dem Feld; mehrzeilige Felder haben eine Zeile je Person oder Absatz. */
const FIELD: Record<Key, { label?: string; hint?: string; rows?: number; wide?: boolean; list?: readonly string[] }> = {
  // In den Einsatzdaten steht darüber schon der Titel des Einsatzes: hier deshalb ausgeschrieben.
  title: { label: "Titel des Datensatzes", wide: true },
  creators: { hint: "Eine Person je Zeile, die ORCID iD darf dahinter stehen.", rows: 2 },
  contributors: { hint: "Eine Person je Zeile, wie oben.", rows: 2 },
  description: { hint: "Was im Material zu sehen und zu hören ist, wo und wozu es entstand.", rows: 3, wide: true },
  keywords: { hint: "Durch Komma getrennt." },
  license: { hint: "Name oder Adresse, z. B. CC BY 4.0.", list: LICENSE_SUGGESTIONS },
  access: { hint: "Wer die Daten bekommt und unter welchen Bedingungen.", list: ACCESS_SUGGESTIONS },
  partOf: { hint: "Projekt, Studie oder Sammlung, gern mit DOI oder Adresse." },
};

/**
 * Alle Felder in zwei Spalten (auf schmalen Flächen in einer). `placeholder` zeigt je Feld, was gilt, solange das Feld
 * leer bleibt: in der Übersicht die Vorbelegung, in den Einsatzdaten der Wert aus dem Projekt.
 */
export function DatasetFields({
  value,
  onChange,
  placeholder = {},
  columns = 2,
}: {
  value: DatasetInfo;
  onChange: (next: DatasetInfo) => void;
  placeholder?: Partial<Record<Key, string>>;
  /** Spalten auf breiten Flächen; im Dialog der Einsatzdaten eine. */
  columns?: 1 | 2;
}) {
  const id = useId();
  return (
    <div className="@container">
      <div className={cx("grid gap-x-5 gap-y-3.5", columns === 2 && "@[44rem]:grid-cols-2")}>
        {DATASET_FIELDS.map(({ key, label }) => {
          const f = FIELD[key];
          const common = {
            value: value[key] ?? "",
            placeholder: placeholder[key],
            onChange: (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value }),
            "data-field": key,
            // Vorgaben kursiv und blass, damit sie sich von Eingetragenem unterscheiden.
            className: "placeholder:text-muted placeholder:italic",
          };
          return (
            <label
              key={key}
              className={cx(
                "grid content-start gap-1 text-[0.9rem] font-medium",
                f.wide && columns === 2 && "@[44rem]:col-span-2",
              )}
            >
              {f.label ?? label}
              {f.rows ? (
                <textarea rows={f.rows} {...common} className={`resize-y ${common.className}`} />
              ) : (
                <input {...common} list={f.list ? `${id}-${key}` : undefined} />
              )}
              {f.list && (
                <datalist id={`${id}-${key}`}>
                  {f.list.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              )}
              {f.hint && <span className="text-[0.82rem] font-normal text-muted">{f.hint}</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}
