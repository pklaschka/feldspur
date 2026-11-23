/** Alle IPC-Aufrufe anmelden, nach Arbeitsschritt geordnet. */
import { registerOutputIpc } from "./output.ts";
import { registerProjectIpc } from "./project.ts";
import { registerReviewIpc } from "./review.ts";
import { registerSessionsIpc } from "./sessions.ts";
import { registerSyncIpc } from "./sync.ts";

export function registerIpc(): void {
  registerProjectIpc();
  registerSessionsIpc();
  registerSyncIpc();
  registerReviewIpc();
  registerOutputIpc();
}
