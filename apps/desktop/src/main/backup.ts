/**
 * Automatische Sicherungen des offenen Projekts.
 *
 * - Beim Öffnen, wenn die letzte automatische Sicherung länger als eine halbe Stunde her ist (so lässt sich der Stand
 *   vor dieser Sitzung immer zurückholen).
 * - Während der Arbeit höchstens alle 30 Minuten, und nur, wenn sich seit der letzten Sicherung etwas geändert hat.
 * - Beim Schließen bzw. Wechseln des Projekts, wenn sich seitdem etwas geändert hat.
 *
 * Die letzten zehn bleiben liegen (`BACKUP_KEEP`). Schlägt eine Sicherung fehl (z. B. schreibgeschützter Ordner),
 * arbeitet die App weiter; die Meldung steht im Dialog „Sicherungen“.
 */
import { BACKUP_KEEP, backupDir, listBackups, nextBackupPath, rotateBackups, type ProjectStore } from "@feldspur/core";
import type { BackupOverview } from "../shared/api.ts";

export const AUTO_BACKUP_INTERVAL_MS = 30 * 60_000;
/** So oft schaut die App nach, ob eine Sicherung fällig ist. */
export const AUTO_BACKUP_CHECK_MS = 5 * 60_000;

export class AutoBackup {
  private store: ProjectStore | null = null;
  private lastCount = 0;
  private lastAt = 0;
  private lastError: string | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Neues Projekt übernehmen. `fresh`: gerade angelegt oder aus einer Sicherung kopiert, also nichts zu sichern. */
  attach(store: ProjectStore, opts: { fresh: boolean }): void {
    this.store = store;
    this.lastError = null;
    this.lastCount = store.changeCount();
    const newest = listBackups(store.path).find((b) => b.kind === "automatisch");
    this.lastAt = newest ? Date.parse(newest.createdAt) : 0;
    if (!opts.fresh && this.now() - this.lastAt >= AUTO_BACKUP_INTERVAL_MS) this.run();
  }

  /** Regelmäßig aufrufen: sichert, wenn es Änderungen gibt und die letzte Sicherung lange genug her ist. */
  tick(): void {
    if (this.changed() && this.now() - this.lastAt >= AUTO_BACKUP_INTERVAL_MS) this.run();
  }

  /** Vor dem Schließen des Projekts: Änderungen seit der letzten Sicherung noch sichern. */
  detach(): void {
    if (this.changed()) this.run();
    this.store = null;
  }

  overview(): BackupOverview | null {
    const s = this.store;
    if (!s) return null;
    return {
      dir: backupDir(s.path),
      backups: listBackups(s.path),
      keepAutomatic: BACKUP_KEEP.automatisch ?? 0,
      lastAutomaticAt: this.lastAt ? new Date(this.lastAt).toISOString() : null,
      lastError: this.lastError,
    };
  }

  private changed(): boolean {
    return !!this.store && this.store.changeCount() !== this.lastCount;
  }

  private run(): void {
    const s = this.store;
    if (!s) return;
    try {
      s.backupTo(nextBackupPath(s.path, "automatisch", new Date(this.now())));
      rotateBackups(s.path, "automatisch");
      this.lastAt = this.now();
      this.lastCount = s.changeCount();
      this.lastError = null;
    } catch (e) {
      this.lastError = `Automatische Sicherung fehlgeschlagen: ${(e as Error).message}`;
      // Nicht bei jedem Blick erneut versuchen, sondern erst nach dem nächsten Abstand.
      this.lastAt = this.now();
    }
  }
}
