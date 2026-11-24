/**
 * Alle IPC-Aufrufe anmelden, nach Arbeitsschritt geordnet. `main.ts` ruft das einmal beim Start auf. Die Namen der
 * Kanäle und die Typen stehen in `apps/desktop/src/shared/api.ts`; dort ist auch vermerkt, welcher Kanal in welcher
 * Datei dieses Ordners beantwortet wird.
 */
import { registerExportIpc } from "./export.ts";
import { registerProjectIpc } from "./project.ts";
import { registerReviewIpc } from "./review.ts";
import { registerSessionsIpc } from "./sessions.ts";
import { registerSyncIpc } from "./sync.ts";

export function registerIpc(): void {
  registerProjectIpc();
  registerSessionsIpc();
  registerSyncIpc();
  registerReviewIpc();
  registerExportIpc();
}
