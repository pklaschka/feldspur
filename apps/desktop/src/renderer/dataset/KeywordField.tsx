/**
 * Schlagworte als einzelne Marken in einem Feld: Enter oder Komma schließt ein Schlagwort ab, die Rücktaste im leeren
 * Feld nimmt das letzte weg, das Kreuz an der Marke dieses eine. Gespeichert wird wie bisher ein Text mit Kommas
 * (`keywordList` in `packages/media/src/dataset.ts` liest ihn).
 */
import { useRef, useState } from "react";
import { keywordList } from "@feldspur/media/dataset";
import { cx } from "../ui.tsx";
import { Sign } from "./parts.tsx";

export function KeywordField({
  id,
  value,
  onChange,
  placeholder,
  describedBy,
}: {
  id: string;
  /** Schlagworte als Text mit Kommas. */
  value: string | undefined;
  onChange: (text: string) => void;
  /** Was gilt, solange nichts eingetragen ist (in den Einsatzdaten die Schlagworte des Projekts). */
  placeholder?: string;
  describedBy?: string;
}) {
  const [words, setWords] = useState(() => keywordList(value));
  // Was gerade getippt wird und noch keine Marke ist. Es zählt schon mit, damit „Speichern“ nichts verliert.
  const [typing, setTyping] = useState("");
  const [announce, setAnnounce] = useState("");
  // Der zuletzt gemeldete Text: Kommt von außen ein anderer (Verwerfen, Dialog neu geöffnet), beginnt das Feld neu.
  const [emitted, setEmitted] = useState(value ?? "");
  if ((value ?? "") !== emitted) {
    setEmitted(value ?? "");
    setWords(keywordList(value));
    setTyping("");
  }
  const input = useRef<HTMLInputElement>(null);

  const update = (nextWords: string[], nextTyping: string) => {
    const list = keywordList(nextWords.join(","));
    setWords(list);
    setTyping(nextTyping);
    const text = keywordList([...list, nextTyping].join(",")).join(", ");
    setEmitted(text);
    onChange(text);
  };
  /** Das Getippte als Marke abschließen. */
  const commit = () => {
    if (!typing.trim()) return typing ? update(words, "") : undefined;
    const fresh = keywordList(typing).filter((w) => !words.includes(w));
    setAnnounce(fresh.length ? `${fresh.join(", ")} hinzugefügt` : "Schon eingetragen");
    update([...words, typing], "");
  };
  const remove = (word: string) => {
    setAnnounce(`${word} entfernt`);
    update(
      words.filter((w) => w !== word),
      typing,
    );
    input.current?.focus();
  };

  return (
    // Der Rahmen sieht aus wie ein Eingabefeld; ein Klick ins Leere setzt die Schreibmarke ins Feld darin.
    <div
      className="flex min-h-[2.125rem] cursor-text flex-wrap items-center gap-1 rounded-lg border border-line-2 bg-panel px-1.5 py-1 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        input.current?.focus();
      }}
    >
      {words.map((w) => (
        <span
          key={w}
          data-keyword={w}
          className="inline-flex max-w-full items-center rounded-full border border-line-2 bg-panel-2 pl-2.5 text-[0.86rem] leading-[1.375rem]"
        >
          <span className="truncate">{w}</span>
          <button
            type="button"
            aria-label={`Schlagwort ${w} entfernen`}
            title="Entfernen"
            onClick={() => remove(w)}
            className="ml-0.5 grid size-[1.375rem] flex-none cursor-pointer place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink"
          >
            <Sign kind="cross" size={10} />
          </button>
        </span>
      ))}
      <input
        ref={input}
        id={id}
        data-field="keywords"
        aria-describedby={describedBy}
        value={typing}
        placeholder={words.length ? undefined : placeholder}
        // Ohne eigenen Rahmen: Den zeichnet die Hülle, auch den Fokusring.
        className={cx(
          "min-w-24 flex-1 rounded-none border-0 bg-transparent px-1 py-0 outline-none focus-visible:outline-none",
          "placeholder:text-muted placeholder:italic",
        )}
        onChange={(e) => {
          const text = e.target.value;
          // Getipptes oder eingefügtes Komma: Alles davor wird zu Marken, der Rest bleibt zum Weiterschreiben.
          if (!/[,;\n]/.test(text)) return update(words, text);
          const parts = text.split(/[,;\n]/);
          const rest = parts.pop() ?? "";
          update([...words, ...parts], rest.trimStart());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && typing.trim()) {
            // Sonst würde Enter das ganze Formular speichern.
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !typing && words.length) {
            remove(words.at(-1)!);
          }
        }}
        onBlur={commit}
      />
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
