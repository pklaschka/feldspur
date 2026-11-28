/**
 * Personenliste für „Urheber*innen“ und „Mitwirkende“: je Person eine Zeile mit Name und ORCID iD, dazu Entfernen und
 * „Person hinzufügen“. Gespeichert wird wie bisher ein Text mit einer Person je Zeile (`formatPeople` schreibt ihn,
 * `parsePeople` liest ihn, beide in `packages/media/src/dataset.ts`); Zeilen ohne Namen fallen dabei weg.
 *
 * Die ORCID iD ist freiwillig. Passt ihre Form nicht, sagt die Zeile das, sobald man sie verlässt, und die iD bleibt
 * aus dem Text heraus, statt als Teil des Namens in der Ausgabe zu landen.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { formatPeople, normalizeOrcid, orcidChecksumOk, parsePeople } from "@feldspur/media/dataset";
import { Button, CloseButton, cx } from "../ui.tsx";
import { HINT, LABEL, Sign, Suggestion } from "./parts.tsx";

interface Row {
  name: string;
  /** Wie getippt; erst beim Verlassen der Zeile in die übliche Schreibweise gebracht. */
  orcid: string;
}
const BLANK: Row = { name: "", orcid: "" };
const isBlank = (r: Row) => !r.name.trim() && !r.orcid.trim();
const toRows = (text: string | undefined): Row[] =>
  parsePeople(text).map((p) => ({ name: p.name, orcid: p.orcid ?? "" }));
const toText = (rows: Row[]) =>
  formatPeople(rows.map((r) => ({ name: r.name, orcid: normalizeOrcid(r.orcid) ?? undefined })));

/** Was an einer Zeile nicht stimmt: am Namen, an der ORCID iD (Fehler) oder nur an ihrer Prüfziffer (Hinweis). */
function problem(r: Row): { at: "name" | "orcid"; tone: "bad" | "warn"; text: string } | null {
  if (!r.orcid.trim()) return null;
  const orcid = normalizeOrcid(r.orcid);
  if (!orcid)
    return {
      at: "orcid",
      tone: "bad",
      text: "Eine ORCID iD hat 16 Zeichen in vier Blöcken, etwa 0000-0002-1825-0097. So wird sie nicht übernommen.",
    };
  if (!r.name.trim()) return { at: "name", tone: "bad", text: "Zu dieser ORCID iD fehlt der Name." };
  if (!orcidChecksumOk(orcid))
    return {
      at: "orcid",
      tone: "warn",
      text: "Die Prüfziffer dieser ORCID iD stimmt nicht. Vergleiche die Ziffern mit dem ORCID-Profil.",
    };
  return null;
}

export function PeopleField({
  field,
  label,
  hint,
  value,
  onChange,
  inherited,
  emptyHint,
  suggestions = [],
  suggestionsLabel,
}: {
  field: "creators" | "contributors";
  label: string;
  hint?: string;
  /** Personen als Text, eine je Zeile. */
  value: string | undefined;
  onChange: (text: string) => void;
  /** In den Einsatzdaten: die Personen des Projekts als Text; sie gelten, solange hier niemand steht. */
  inherited?: string;
  /** Was gilt, solange niemand eingetragen ist und es nichts aus dem Projekt gibt. */
  emptyHint?: string;
  /** Namen zum Übernehmen mit einem Klick (die Forschenden an den Geräten). */
  suggestions?: readonly string[];
  suggestionsLabel?: string;
}) {
  const id = useId();
  const [rows, setRows] = useState(() => toRows(value));
  // Der zuletzt gemeldete Text: Kommt von außen ein anderer (Verwerfen, Dialog neu geöffnet), beginnt die Liste neu.
  const [emitted, setEmitted] = useState(value ?? "");
  if ((value ?? "") !== emitted) {
    setEmitted(value ?? "");
    setRows(toRows(value));
  }
  // Die Zeile, in der gerade getippt wird: Ihre Meldung wartet, bis man sie verlässt.
  const [active, setActive] = useState<number | null>(null);
  const names = useRef<(HTMLInputElement | null)[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  // Fokus nach dem nächsten Zeichnen: eine Zeile (Zahl) oder der Knopf „Person hinzufügen“.
  const focusNext = useRef<number | "add" | null>(null);
  const removed = useRef(false);
  useEffect(() => {
    removed.current = false;
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "add") addButton.current?.focus();
    else if (target !== null) names.current[target]?.focus();
  });

  const inheritedNames = parsePeople(inherited)
    .map((p) => p.name)
    .join(", ");
  // Ohne Eintrag steht eine leere Zeile zum Lostippen da; in den Einsatzdaten stattdessen, wer aus dem Projekt gilt.
  const shown = rows.length || inheritedNames ? rows : [BLANK];
  const update = (next: Row[]) => {
    setRows(next);
    const text = toText(next);
    setEmitted(text);
    onChange(text);
  };
  const edit = (i: number, patch: Partial<Row>) => update(shown.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  /** Beim Verlassen einer Zeile: ORCID iD in die übliche Schreibweise, eine iD im Namensfeld ins eigene Feld. */
  const tidy = (i: number) => {
    const r = shown[i];
    if (!r || removed.current) return;
    const inName = r.orcid.trim() ? undefined : parsePeople(r.name)[0];
    const next = inName?.orcid
      ? { name: inName.name, orcid: inName.orcid }
      : { name: r.name.trim(), orcid: normalizeOrcid(r.orcid) ?? r.orcid.trim() };
    if (next.name !== r.name || next.orcid !== r.orcid) edit(i, next);
  };
  const add = (name = "") => {
    const blank = shown.findIndex(isBlank);
    // Eine leere Zeile ist schon da: ohne Namen nur hinspringen, mit Namen sie füllen.
    if (blank >= 0 && !name) return names.current[blank]?.focus();
    if (blank >= 0) edit(blank, { name });
    else update([...shown, { name, orcid: "" }]);
    focusNext.current = name ? "add" : shown.length;
  };
  const remove = (i: number) => {
    // Die Zeile verschwindet samt Fokus; ihr Verlassen soll sie nicht noch einmal anfassen.
    removed.current = true;
    update(shown.filter((_, j) => j !== i));
    setActive(null);
    focusNext.current = "add";
  };
  /** Enter führt zur nächsten Person, statt das ganze Formular zu speichern. */
  const onEnter = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (i + 1 < shown.length) names.current[i + 1]?.focus();
    else if (!isBlank(shown[i]!)) add();
  };

  const open = suggestions.filter((s) => !shown.some((r) => r.name.trim() === s));
  const nothing = !emitted;
  const hintId = `${id}-hint`;
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={hint ? hintId : undefined} data-field={field}>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <span id={`${id}-label`} className={LABEL}>
          {label}
        </span>
        {hint && (
          <span id={hintId} className={HINT}>
            {hint}
          </span>
        )}
      </div>
      {nothing && inheritedNames && (
        <p className="mb-1.5 text-muted italic" data-inherited>
          Wie im Projekt: {inheritedNames}
        </p>
      )}
      {shown.length > 0 && (
        <div className="grid gap-1.5">
          <div aria-hidden className={cx(HINT, "-mb-0.5 flex gap-2")}>
            <span className="min-w-0 flex-1">Name</span>
            <span className="w-[11.5rem]">ORCID iD</span>
            <span className="w-7" />
          </div>
          {shown.map((r, i) => {
            const p = active === i ? null : problem(r);
            const problemId = `${id}-problem-${i}`;
            const who = r.name.trim() || `Person ${i + 1}`;
            return (
              <div
                key={i}
                data-person={i}
                onFocus={() => setActive(i)}
                onBlur={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget)) return;
                  setActive(null);
                  tidy(i);
                }}
              >
                <div className="flex items-center gap-2">
                  <input
                    ref={(el) => {
                      names.current[i] = el;
                    }}
                    className="min-w-0 flex-1"
                    aria-label={`Person ${i + 1}: Name`}
                    aria-invalid={p?.at === "name" || undefined}
                    aria-describedby={p?.at === "name" ? problemId : undefined}
                    autoComplete="off"
                    value={r.name}
                    onChange={(e) => edit(i, { name: e.target.value })}
                    onKeyDown={onEnter(i)}
                  />
                  <input
                    className={cx(
                      "w-[11.5rem] flex-none font-mono placeholder:text-muted",
                      p?.at === "orcid" && (p.tone === "bad" ? "border-bad" : "border-warn"),
                    )}
                    aria-label={`Person ${i + 1}: ORCID iD`}
                    aria-invalid={(p?.at === "orcid" && p.tone === "bad") || undefined}
                    aria-describedby={p?.at === "orcid" ? problemId : undefined}
                    placeholder="0000-0000-0000-0000"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={r.orcid}
                    onChange={(e) => edit(i, { orcid: e.target.value })}
                    onKeyDown={onEnter(i)}
                  />
                  {/* Die eine leere Zeile bleibt stehen: Platz halten, damit die Spalten nicht springen. */}
                  {rows.length ? (
                    <CloseButton label={`${who} entfernen`} onClick={() => remove(i)} />
                  ) : (
                    <span className="w-7 flex-none" />
                  )}
                </div>
                {p && (
                  <p id={problemId} className={cx("mt-1 text-[0.82rem]", p.tone === "bad" ? "text-bad" : "text-warn")}>
                    {p.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button
          ref={addButton}
          size="sm"
          type="button"
          className="inline-flex items-center gap-1.5"
          onClick={() => add()}
        >
          <Sign kind="plus" />
          Person hinzufügen
        </Button>
        {open.length > 0 && (
          <span role="group" aria-label={suggestionsLabel} className="flex flex-wrap items-center gap-1.5">
            <span className={HINT}>{suggestionsLabel}:</span>
            {open.map((s) => (
              <Suggestion key={s} onClick={() => add(s)}>
                <Sign kind="plus" size={10} />
                {s}
              </Suggestion>
            ))}
          </span>
        )}
      </div>
      {nothing && !inheritedNames && emptyHint && <p className={cx(HINT, "mt-1.5")}>{emptyHint}</p>}
    </div>
  );
}
