/**
 * Dialog „Sicherungen“: automatische und eigene Sicherungen des offenen Projekts, neueste oben. Jede lässt sich als
 * eigenständige Kopie öffnen; das Projekt selbst wird dabei nie überschrieben.
 */
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import type { BackupInfo } from "@feldspur/core";
import type { BackupOverview, ProjectInfo } from "../shared/api.ts";
import { bytes } from "./format.ts";
import { Button, CloseButton, ErrorBanner } from "./ui.tsx";

const api = window.feldspur;

const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

export const KIND_LABEL: Record<BackupInfo["kind"], string> = {
  automatisch: "automatisch",
  "vor-Aktualisierung": "vor Aktualisierung auf neue Version",
  manuell: "von Hand",
};

export function Backups({
  open,
  onOpenChange,
  onOpened,
  guard,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Die wiederhergestellte Kopie ist jetzt das offene Projekt. */
  onOpened: (p: ProjectInfo) => void;
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setOverview(null);
      setSaved(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api.backups().then((o) => live && setOverview(o));
    return () => {
      live = false;
    };
  }, [open, reload]);

  const openCopy = (path?: string) =>
    void guard(() => api.openBackupCopy(path)).then((p) => {
      if (!p) return;
      onOpenChange(false);
      onOpened(p);
    });

  const create = () =>
    void guard(api.createBackup).then((p) => {
      if (!p) return;
      setSaved(p);
      setReload((n) => n + 1);
    });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(680px,94vw)] -translate-1/2 flex-col rounded-xl border border-line bg-panel p-5 shadow-2xl"
          data-testid="backups"
        >
          <div className="mb-1 flex items-center">
            <Dialog.Title className="text-base font-semibold">Sicherungen</Dialog.Title>
            <span className="flex-1" />
            <CloseButton onClick={() => onOpenChange(false)} />
          </div>
          <Dialog.Description className="mb-3 text-[0.86rem] text-pretty text-muted">
            Feldspur sichert das Projekt beim Öffnen, während der Arbeit höchstens alle 30 Minuten und beim Schließen,
            jeweils nur, wenn sich etwas geändert hat. Die letzten {overview?.keepAutomatic ?? 10} automatischen
            Sicherungen bleiben liegen, eigene Sicherungen immer. Eine Sicherung öffnet sich als Kopie; das Projekt
            selbst bleibt unverändert.
          </Dialog.Description>
          <ErrorBanner dialog className="mb-3" />
          {overview?.lastError && (
            <p className="mb-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[0.88rem]" role="alert">
              {overview.lastError}
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line">
            {overview === null && <p className="p-3 text-[0.9rem] text-muted">Wird geladen…</p>}
            {overview?.backups.length === 0 && (
              <p className="p-3 text-[0.9rem] text-muted">Noch keine Sicherungen in diesem Ordner.</p>
            )}
            <ul>
              {overview?.backups.map((b) => (
                <li
                  key={b.path}
                  className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
                  data-testid="backup-row"
                >
                  <span className="w-44 flex-none text-[0.88rem] tabular-nums">{when(b.createdAt)}</span>
                  <span className="min-w-0 flex-1 truncate text-[0.88rem] text-muted" title={b.fileName}>
                    {KIND_LABEL[b.kind]} · {bytes(b.size)}
                  </span>
                  <Button size="sm" onClick={() => openCopy(b.path)}>
                    Als Kopie öffnen…
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[0.82rem] text-muted">
            <span className="min-w-0 flex-1 truncate" title={overview?.dir}>
              {saved ? `Gespeichert: ${saved}` : overview?.dir}
            </span>
            <button className="cursor-pointer underline hover:text-ink" onClick={() => void api.showBackupFolder()}>
              Ordner zeigen
            </button>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button onClick={() => openCopy()}>Andere Datei als Kopie öffnen…</Button>
            <Button variant="primary" onClick={create}>
              Sicherung erstellen…
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
