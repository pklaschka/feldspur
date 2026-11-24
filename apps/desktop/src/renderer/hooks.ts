/** Kleine Hooks, die mehrere Ansichten brauchen. */
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

/**
 * Entwurf eines Werts aus der Projektdatei, z. B. für ein Eingabefeld, das erst beim Verlassen speichert.
 * Ändert sich der Wert von außen (Speichern, Rückgängig, andere Quelle), folgt der Entwurf ihm sofort, noch im
 * selben Durchlauf, statt wie mit einem Effekt erst ein Bild später. `resetKey` setzt den Entwurf zusätzlich
 * zurück, wenn sich etwas anderes ändert (z. B. ein Dialog geht auf), auch wenn der Wert gleich bleibt.
 */
export function useDraft<T>(value: T, resetKey?: unknown): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState({ value, resetKey });
  if (!Object.is(seen.value, value) || !Object.is(seen.resetKey, resetKey)) {
    setSeen({ value, resetKey });
    setDraft(value);
  }
  return [draft, setDraft];
}

/** Stand von `useLoaded`. `value` kann auch beim Laden oder nach einem Fehler noch den letzten Wert tragen. */
export type Loaded<T> =
  | { state: "idle" | "loading"; value: T | undefined }
  | { state: "done"; value: T }
  | { state: "failed"; value: T | undefined; error: unknown };

/**
 * Daten zu einem Schlüssel laden (z. B. Quelle oder offener Dialog). Neuer Schlüssel: neu laden, Antworten zu einem
 * alten Schlüssel zählen nicht mehr. `null` lädt nichts. Ohne `keep` beginnt jeder neue Schlüssel leer („loading“),
 * mit `keep` bleibt der letzte Wert stehen, bis der neue da ist (gegen Flackern beim Nachladen).
 */
export function useLoaded<T>(
  key: string | null,
  load: (key: string) => Promise<T>,
  opts: { keep?: boolean } = {},
): Loaded<T> {
  const fresh = (k: string | null, value?: T): Loaded<T> & { key: string | null } => ({
    key: k,
    state: k === null ? "idle" : "loading",
    value,
  });
  const [cur, setCur] = useState<Loaded<T> & { key: string | null }>(() => fresh(key));
  let shown = cur;
  if (cur.key !== key) {
    shown = fresh(key, opts.keep ? cur.value : undefined);
    setCur(shown);
  }
  const run = useEffectEvent(load);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    run(key).then(
      (value) => live && setCur({ key, state: "done", value }),
      (error: unknown) => live && setCur((c) => ({ key, state: "failed", value: c.value, error })),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return shown;
}

/**
 * Immer der zuletzt gerenderte Wert, für Handler, die selbst stabil bleiben sollen (z. B. an Elementen, die nur
 * einmal einen Listener bekommen, oder in memo-Zeilen). Aktualisiert nach jedem Rendern, nicht währenddessen.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
