/**
 * `window.feldspur`: der einzige Weg der Oberfläche zum Hauptprozess (Projektdatei, Dateien, ffmpeg). Die Methoden
 * beschreibt `FeldspurApi` in `apps/desktop/src/shared/api.ts`; die Brücke dazu legt
 * `apps/desktop/src/preload/preload.ts` an, die Handler liegen unter `apps/desktop/src/main/ipc/`.
 */
import type { FeldspurApi } from "../shared/api.ts";

declare global {
  interface Window {
    feldspur: FeldspurApi;
  }
}
