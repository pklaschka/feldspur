/**
 * Uhrzeit als Maskenfeld: nur Ziffern tippen, der Doppelpunkt kommt von selbst („1030“ → 10:30, mit Sekunden
 * „103045“ → 10:30:45). ↑/↓ verschieben um eine Minute, mit Umschalt um zehn. Überall, wo eine Uhrzeit eingetippt
 * wird, damit sich alle Zeitfelder gleich verhalten.
 *
 * Benutzt für Zeitbelege von Hand (`inspector/Evidence.tsx`) und die Notierzeit von Tagebucheinträgen
 * (`diary/EntryCard.tsx`, `inspector/DiaryPage.tsx`). Die Maske selbst rechnet `format.ts` (`maskClockAt`,
 * `normalizeClock`, `stepClock`); der Wert ist immer Text, keine Zahl.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { type ClockOpts, clockLength, maskClockAt, normalizeClock, stepClock } from "./format.ts";
import { cx } from "./ui.tsx";
import { isEnter } from "./keys.js";

/** Das Eingabefeld allein, ohne Beschriftung (das zugängliche Label kommt über `ariaLabel`). */
export function ClockInput({
  ariaLabel,
  value,
  onChange,
  onCommit,
  seconds = false,
  advance = true,
  autoFocus = false,
  className,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  /** Beim Verlassen (oder Enter) mit gültiger Uhrzeit, ergänzt zu „hh:mm“ bzw. „hh:mm:ss“; leer = "". */
  onCommit?: (v: string) => void;
  /** Sekunden erlaubt („hh:mm:ss“). */
  seconds?: boolean;
  /** Vollständig getippt: gleich ins nächste Feld springen. */
  advance?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const opts: ClockOpts = { seconds };
  const valid = normalizeClock(value, opts) !== null;
  const input = useRef<HTMLInputElement>(null);
  /** Wohin die Schreibmarke nach dem nächsten Rendern gehört; null = nichts zu tun. */
  const caret = useRef<number | null>(null);
  // Nach der Maske die Schreibmarke dorthin setzen, wo getippt wurde, statt ans Ende.
  useLayoutEffect(() => {
    if (caret.current === null || document.activeElement !== input.current) return;
    input.current!.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const full = clockLength(opts);
  const example = seconds ? "103045 für 10:30:45" : "1030 für 10:30";
  return (
    <input
      className={cx(seconds ? "w-24" : "w-20", "font-mono", !valid && "border-bad text-bad", className)}
      placeholder={seconds ? "hh:mm:ss" : "hh:mm"}
      inputMode="numeric"
      maxLength={full + 1}
      ref={input}
      value={value}
      aria-label={ariaLabel}
      aria-invalid={!valid}
      title={
        valid ? `Uhrzeit, nur Ziffern, z. B. ${example}. ↑/↓: eine Minute, mit Umschalt zehn.` : "Keine gültige Uhrzeit"
      }
      onChange={(e) => {
        const el = e.target;
        const m = maskClockAt(el.value, el.selectionStart ?? el.value.length, opts);
        caret.current = m.caret;
        onChange(m.value);
        // Uhrzeit vollständig am Ende getippt: gleich ins nächste Feld (das Verlassen speichert sie).
        if (
          advance &&
          m.value.length === full &&
          m.caret === full &&
          normalizeClock(m.value, opts) &&
          m.value !== value
        ) {
          const fields = [...document.querySelectorAll<HTMLElement>("input, textarea, select")].filter(
            (f) => !(f as HTMLInputElement).disabled && f.offsetParent !== null,
          );
          requestAnimationFrame(() => fields[fields.indexOf(el) + 1]?.focus());
        }
      }}
      onKeyDown={(e) => {
        if (isEnter(e)) {
          // In einem Formular schickt Enter es ab; vorher die Uhrzeit ergänzen.
          const n = normalizeClock(value, opts);
          if (n) onChange(n);
          if (!e.currentTarget.form) e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange(stepClock(value, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1), opts));
        }
      }}
      onBlur={() => {
        const n = normalizeClock(value, opts);
        if (n === null) return; // ungültig: stehen lassen und rot zeigen, nichts speichern
        onChange(n);
        onCommit?.(n);
      }}
    />
  );
}

/** ClockInput mit Beschriftung darüber. */
export function ClockField({ label, ...rest }: { label: ReactNode } & Parameters<typeof ClockInput>[0]) {
  return (
    <label className="grid gap-0.5">
      <span className="text-muted">{label}</span>
      <ClockInput {...rest} />
    </label>
  );
}
