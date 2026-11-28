/**
 * Die Felder der Angaben zum Datensatz (Issue #206), gemeinsam für die Übersicht (Angaben fürs Projekt,
 * `overview/DatasetCard.tsx`) und die Einsatzdaten (Angaben, die nur für einen Einsatz gelten, `SessionDetails.tsx`).
 * Welche Felder es gibt, steht in `packages/media/src/dataset.ts`; hier, wie sie gegliedert sind und aussehen.
 *
 * Drei Gruppen: Inhalt, Personen, Nutzung; darunter die Vorschau (`DatasetPreview.tsx`). Auf breiten Flächen steht die Überschrift der Gruppe links neben ihren
 * Feldern, auf schmalen (Dialog der Einsatzdaten) darüber; das entscheidet die Breite der Fläche, nicht der Aufrufer.
 */
import { useId, useRef, type ReactNode } from "react";
import type { DatasetInfo } from "@feldspur/core/model";
import { ACCESS_SUGGESTIONS, cleanDataset, DATASET_FIELDS, LICENSE_SUGGESTIONS } from "@feldspur/media/dataset";
import { DatasetPreview } from "./DatasetPreview.tsx";
import { cx } from "../ui.tsx";
import { KeywordField } from "./KeywordField.tsx";
import { HINT, LABEL, PLACEHOLDER, Suggestion } from "./parts.tsx";
import { PeopleField } from "./PeopleField.tsx";

type Key = keyof DatasetInfo;

const LABELS = Object.fromEntries(DATASET_FIELDS.map((f) => [f.key, f.label])) as Record<Key, string>;

/** Überschrift einer Gruppe mit ihren Feldern; die Linie darüber trennt sie von der vorigen. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-3 border-t border-line py-4 last:pb-0 @[52rem]:grid-cols-[10rem_minmax(0,44rem)] @[52rem]:py-5">
      <h3 className="text-[0.95rem] font-semibold">{title}</h3>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

/** Ein Feld mit Beschriftung darüber und Hinweis darunter. */
function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("grid content-start gap-1", className)}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {hint && (
        <span id={`${id}-hint`} className={HINT}>
          {hint}
        </span>
      )}
    </div>
  );
}

/** Was am Titel steht, solange in der Übersicht keiner eingetragen ist. */
const NO_TITLE = "Ohne Titel heißt jede Ausgabe nach Einsatz und Datum";

/**
 * Alle Felder, darunter die Vorschau. Mit `project` (Einsatzdaten) zeigt jedes leere Feld grau, was aus dem Projekt
 * gilt, bei den Personen als Zeile „Wie im Projekt: …“; ohne (Übersicht) steht nur am Titel, was ohne Eintrag gilt.
 */
export function DatasetFields({
  value,
  onChange,
  project,
  researchers = [],
  titleSuggestion,
  settled,
}: {
  value: DatasetInfo;
  onChange: (next: DatasetInfo) => void;
  /** In den Einsatzdaten: die Angaben des Projekts, die gelten, solange hier nichts steht. */
  project?: DatasetInfo;
  /** Forschende an den Geräten: Vorschläge für „Urheber*innen“ und, ohne Eintrag, ohnehin die Urheber*innen. */
  researchers?: readonly string[];
  /** Vorschlag für den Titel, solange keiner eingetragen ist (der Name des Projekts). */
  titleSuggestion?: string;
  /** Zählt die Speicherungen, damit die Vorschau danach kurz aufleuchtet. */
  settled?: number;
}) {
  const placeholder: DatasetInfo = project ? cleanDataset(project) : { title: NO_TITLE };
  const titleField = useRef<HTMLInputElement>(null);
  const id = useId();
  const set = (key: Key) => (text: string) => onChange({ ...value, [key]: text });
  /** Was ein einfaches Eingabefeld braucht. */
  const text = (key: Key, hint: boolean) => ({
    id: `${id}-${key}`,
    "data-field": key,
    value: value[key] ?? "",
    placeholder: placeholder[key],
    "aria-describedby": hint ? `${id}-${key}-hint` : undefined,
    onChange: (e: { target: { value: string } }) => set(key)(e.target.value),
    className: PLACEHOLDER,
  });
  return (
    <div className="@container">
      <Group title="Inhalt">
        {/* In den Einsatzdaten steht darüber schon der Titel des Einsatzes: hier deshalb ausgeschrieben. */}
        <Field id={`${id}-title`} label="Titel des Datensatzes">
          <input ref={titleField} {...text("title", false)} />
          {titleSuggestion && !value.title?.trim() && (
            <div
              role="group"
              aria-label="Vorschlag für den Titel"
              className="mt-0.5 flex flex-wrap items-center gap-1.5"
            >
              <span className={HINT}>Name des Projekts:</span>
              <Suggestion
                onClick={() => {
                  set("title")(titleSuggestion);
                  // Der Vorschlag verschwindet mit dem Klick: Der Fokus geht ins Feld, zum Weiterschreiben.
                  titleField.current?.focus();
                }}
              >
                {titleSuggestion}
              </Suggestion>
            </div>
          )}
        </Field>
        <Field
          id={`${id}-description`}
          label={LABELS.description}
          hint="Was zu sehen und zu hören ist, wo und wozu es entstand."
        >
          <textarea rows={3} {...text("description", true)} className={cx("resize-y", PLACEHOLDER)} />
        </Field>
        <Field id={`${id}-keywords`} label={LABELS.keywords} hint="Enter oder Komma schließt ein Schlagwort ab.">
          <KeywordField
            id={`${id}-keywords`}
            value={value.keywords}
            onChange={set("keywords")}
            placeholder={placeholder.keywords}
            describedBy={`${id}-keywords-hint`}
          />
        </Field>
        <Field id={`${id}-partOf`} label={LABELS.partOf} hint="Projekt, Studie oder Sammlung, gern mit DOI.">
          <input {...text("partOf", true)} />
        </Field>
      </Group>
      <Group title="Personen">
        <PeopleField
          field="creators"
          label={LABELS.creators}
          value={value.creators}
          onChange={set("creators")}
          inherited={placeholder.creators}
          emptyHint="Ohne Eintrag gelten die Forschenden an den Geräten des Einsatzes."
          suggestions={researchers}
          suggestionsLabel="Forschende an den Geräten"
        />
        <PeopleField
          field="contributors"
          label={LABELS.contributors}
          hint="Wer beigetragen hat, ohne Urheber*in zu sein."
          value={value.contributors}
          onChange={set("contributors")}
          inherited={placeholder.contributors}
        />
      </Group>
      <Group title="Nutzung">
        <div className="grid gap-x-6 gap-y-4 @[40rem]:grid-cols-2">
          <Choices
            id={`${id}-license`}
            label={LABELS.license}
            hint="Name oder Adresse der Lizenz."
            options={LICENSE_SUGGESTIONS}
            input={text("license", true)}
            onPick={set("license")}
          />
          {/* Ohne Vorauswahl: Feldmaterial ist oft sensibel, den Zugang legt nur fest, wer ihn einträgt. */}
          <Choices
            id={`${id}-access`}
            label={LABELS.access}
            hint="Wer die Daten bekommt und unter welchen Bedingungen."
            options={ACCESS_SUGGESTIONS}
            input={text("access", true)}
            onPick={set("access")}
          />
        </div>
      </Group>
      <Group title={project ? "Gilt für diesen Einsatz" : "Vorschau"}>
        <DatasetPreview value={value} project={project} settled={settled} />
      </Group>
    </div>
  );
}

/** Freies Eingabefeld mit sichtbaren Vorschlägen darunter; ein Klick trägt den Vorschlag ein, ein zweiter leert. */
function Choices({
  id,
  label,
  hint,
  options,
  input,
  onPick,
}: {
  id: string;
  label: string;
  hint: string;
  options: readonly string[];
  input: { value: string } & Record<string, unknown>;
  onPick: (text: string) => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const current = input.value.trim();
  return (
    <Field id={id} label={label} hint={hint}>
      <input ref={field} {...input} />
      <div role="group" aria-label={`Vorschläge für ${label}`} className="order-last mt-0.5 flex flex-wrap gap-1.5">
        {options.map((o) => {
          // „Gesperrt bis …“ ist ein Anfang zum Weiterschreiben: ohne die Punkte eintragen und ins Feld springen.
          const open = o.endsWith("…");
          return (
            <Suggestion
              key={o}
              aria-pressed={open ? undefined : current === o}
              onClick={() => {
                if (!open) return onPick(current === o ? "" : o);
                onPick(o.slice(0, -1));
                field.current?.focus();
              }}
            >
              {o}
            </Suggestion>
          );
        })}
      </div>
    </Field>
  );
}
