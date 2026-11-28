/**
 * Kleine Bausteine, die sich die Felder der Angaben zum Datensatz teilen (`DatasetFields.tsx`, `PeopleField.tsx`,
 * `KeywordField.tsx`): Schriftgrade für Beschriftung und Hinweis, die Zeichen Plus und Kreuz und der Vorschlag als
 * kleiner Knopf.
 */
import type { ButtonHTMLAttributes } from "react";
import { cx } from "../ui.tsx";

/** Beschriftung eines Felds und der Hinweis darunter, wie in den Einsatzdaten. */
export const LABEL = "text-[0.9rem] font-medium";
export const HINT = "text-[0.82rem] font-normal text-muted";
/** Vorgaben (was gilt, solange das Feld leer bleibt) kursiv, damit sie sich von Eingetragenem unterscheiden. */
export const PLACEHOLDER = "placeholder:text-muted placeholder:italic";

/** Plus oder Kreuz als Linienzeichen, in der Strichstärke des Schließen-Knopfs. */
export function Sign({ kind, size = 12 }: { kind: "plus" | "cross"; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <path d={kind === "plus" ? "M8 3v10M3 8h10" : "m4 4 8 8M12 4l-8 8"} />
    </svg>
  );
}

/**
 * Vorschlag unter einem Feld: ein Klick trägt ihn ein. Mit `aria-pressed` zeigt er, dass er gerade eingetragen ist
 * (dann nimmt ein zweiter Klick ihn wieder heraus).
 */
export function Suggestion({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-full border border-line-2 px-2.5 text-[0.82rem] text-ink-2 hover:border-muted hover:bg-panel-2 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:font-medium aria-pressed:text-accent",
        className,
      )}
      {...rest}
    />
  );
}
