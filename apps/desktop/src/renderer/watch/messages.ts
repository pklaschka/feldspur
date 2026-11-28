/**
 * Nachrichten zwischen dem Schritt „Ansehen“ (`Watch.tsx`) und seinem Rahmen (`watch.html`, `frame.ts`), Issue #131.
 *
 * Der Viewer läuft in einem eigenen Rahmen, damit sein Aussehen, seine Tasten und seine Breitenstufen so gelten wie
 * in der ausgegebenen HTML-Datei. Der Rahmen hat keinen Zugang zu `window.feldspur`; alles, was er braucht oder
 * auslöst, geht als Nachricht (`postMessage`) über die Oberfläche.
 */
import type { LevelRow, WatchPreview } from "../../shared/api.ts";

/** Oberfläche → Rahmen. */
export type ToFrame =
  /** Einmal nach `ready`: was zu zeigen ist und an welcher Stelle (Sekunden ab Beginn der Montage). */
  | { type: "load"; preview: WatchPreview; levels: [string, LevelRow | null][]; at: number }
  /** Wiedergabe anhalten (Schritt verlassen, Fenster davor). */
  | { type: "pause" }
  /** Antwort auf `image`: das Bild als JPEG, oder null, wenn es sich nicht lesen ließ. */
  | { type: "image"; n: number; data: ArrayBuffer | null };

/** Rahmen → Oberfläche. */
export type FromFrame =
  /** Das Skript des Rahmens ist geladen und wartet auf `load`. */
  | { type: "ready" }
  /** Aktuelle Stelle in Sekunden, damit sie ein Neuladen übersteht. */
  | { type: "at"; t: number }
  /** „Bearbeiten“ an der Zeile mit diesem Index (`WatchPreview.origins`). */
  | { type: "edit"; index: number }
  /** Bild Nummer `n` (`WatchPreview.images`) kommt ins Bild und wird gebraucht. */
  | { type: "image"; n: number }
  /** Tastenkürzel der App (Strg/⌘ + Taste), die im Rahmen gedrückt wurden. */
  | { type: "key"; key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
