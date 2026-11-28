/**
 * Einstieg der Oberfläche (Renderer-Prozess von Electron): `index.html` lädt diese Datei, sie hängt `App` in `#root`.
 * Mit dem Hauptprozess spricht die Oberfläche nur über `window.feldspur` (siehe `env.d.ts`).
 *
 * Wo was liegt (alles unter `apps/desktop/src/renderer/`):
 * - `App.tsx`: der Rahmen. Startbildschirm, links die Einsatzliste mit Projektmenü (`Recent.tsx`), Dialoge
 *   „Änderungsprotokoll“ (`ChangeLog.tsx`) und „Sicherungen“ (`Backups.tsx`), die Übersicht des Projekts
 *   (`Overview.tsx`, `overview/`). Kleinteile dazu in `app/`.
 * - `app/SessionPane.tsx`: ein geöffneter Einsatz (`FieldSession`) mit den fünf Schritten als Reiter:
 *   Einsammeln (`Collect.tsx`), Abgleichen (`Sync.tsx`, Feinabgleich in `FineAlign.tsx`), Durchsehen (`Review.tsx`,
 *   `review/`, Zeichnen der Zeitachse in `timeline.ts`, Kontext in `context/`), Ansehen (`Watch.tsx`, der Viewer in
 *   einem eigenen Rahmen: `watch.html`, `watch/`) und Ausgeben (`ExportStep.tsx`, `export/`).
 * - Detailleiste rechts neben den Schritten: `Inspector.tsx`, `inspector/`.
 * - Dialoge eines Einsatzes: Mitschreiben (`Transcriber.tsx`, `transcriber/`, `transcribe.ts`), Tagebuch abtippen
 *   (`DiaryEditor.tsx`, `diary/`), große Vorschau (`Preview.tsx`), Schnellsuche (`SearchDialog.tsx`, `search.ts`),
 *   Originaldateien (`Originals.tsx`), Einsatzdaten (`SessionDetails.tsx`).
 * - Kleingeschriebene Dateien auf dieser Ebene haben keine eigene Ansicht: Bausteine (`ui.tsx`), Texte und
 *   Eingaben (`format.ts`), Hooks (`hooks.ts`), Tasten (`keys.ts`) und Zustand, der Schritt- und Einsatzwechsel
 *   übersteht (`importState.ts`, `exportState.tsx`, `playback.tsx`).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
