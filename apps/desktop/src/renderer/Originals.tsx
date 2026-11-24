/**
 * Originaldateien: Hinweis, wenn welche fehlen oder verändert sind, und ein Dialog zum Prüfen und Neu-Verknüpfen
 * (Issues #70, #74). Ein neuer Pfad gilt nur, wenn die Prüfsumme zum Einsammeln passt.
 *
 * Hintergrund: Das Projekt speichert von jeder Quelle nur Pfad und Prüfsumme, nicht die Datei selbst. Leiste und
 * Dialog hängen in `app/SessionPane.tsx`, die Texte nutzen auch `Inspector.tsx` und `export/PreCheckResult.tsx`.
 * Prüfen, Suchen und Neu-Verknüpfen laufen im Hauptprozess (`apps/desktop/src/main/originals.ts`, IPC in
 * `apps/desktop/src/main/ipc/export.ts`).
 */
import type { FileState } from "@feldspur/media";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import type { OriginalsProgress, OriginalsSearch, SessionView, SourceRow } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { Button, CloseButton, cx, ErrorBanner, Glyph } from "./ui.tsx";

const api = window.feldspur;

/** Zustand einer Originaldatei (`FileState` aus `packages/media`) in Worten. */
export const FILE_STATE_TEXT: Record<FileState, string> = {
  ok: "unverändert",
  unchecked: "da, Prüfsumme nicht geprüft",
  changed: "verändert",
  missing: "fehlt",
  unreadable: "nicht prüfbar",
};
const FILE_STATE_CLASS: Record<FileState, string> = {
  ok: "text-good",
  unchecked: "text-muted",
  changed: "text-warn",
  missing: "text-bad",
  unreadable: "text-bad",
};

/** Muss die Datei neu verknüpft werden? (fehlt, nicht lesbar, verändert) */
export const needsRelink = (r: Pick<SourceRow, "file">) =>
  r.file === "missing" || r.file === "unreadable" || r.file === "changed";

/** „Nicht prüfbar“ zählt wie „fehlt“: In beiden Fällen kommt Feldspur nicht an die Datei. */
const counts = (rows: Pick<SourceRow, "file">[]) => ({
  missing: rows.filter((r) => r.file === "missing" || r.file === "unreadable").length,
  changed: rows.filter((r) => r.file === "changed").length,
});
const originals = (n: number) => (n === 1 ? "1 Originaldatei" : `${n} Originaldateien`);

/**
 * Satz über die Auffälligkeiten, z. B. „Feldspur findet 2 Originaldateien nicht, 1 ist verändert.“; null, wenn alles
 * da ist. „Findet nicht“ statt „fehlt“: meist ist nur die Platte nicht angeschlossen (Issue #194).
 */
export function originalsSummary(rows: Pick<SourceRow, "file">[]): string | null {
  const { missing, changed } = counts(rows);
  if (missing && changed)
    return `Feldspur findet ${originals(missing)} nicht, ${changed} ${changed === 1 ? "ist" : "sind"} verändert.`;
  if (missing) return `Feldspur findet ${originals(missing)} nicht.`;
  if (changed) return `${originals(changed)} ${changed === 1 ? "ist" : "sind"} verändert.`;
  return null;
}

/** Was das für das Projekt heißt und was zu tun ist; null, wenn alles da ist. */
export function originalsDetail(rows: Pick<SourceRow, "file">[]): string | null {
  const { missing, changed } = counts(rows);
  const safe = "Im Projekt ist nichts verloren: Zeiten, Mitschrift, Notizen und Tagebuchtexte sind vollständig.";
  if (missing && changed)
    return `${safe} ${changed === 1 ? "Die veränderte Datei ist" : "Die veränderten Dateien sind"} nicht mehr die vom Einsammeln.`;
  if (missing)
    return `${safe} Oft ist nur die Festplatte nicht angeschlossen oder ein Ordner umbenannt. Für Vorschau, Tonanalyse und Ausgabe braucht Feldspur die Originale.`;
  if (changed)
    return changed === 1
      ? "Sie ist nicht mehr die Datei, die du eingesammelt hast: Größe oder Prüfsumme sind anders. Zeiten und Mitschrift im Projekt bleiben, wie sie sind, beziehen sich aber auf die Datei vom Einsammeln. Eine unveränderte Kopie lässt sich neu verknüpfen."
      : "Sie sind nicht mehr die Dateien, die du eingesammelt hast: Größe oder Prüfsumme sind anders. Zeiten und Mitschrift im Projekt bleiben, wie sie sind, beziehen sich aber auf die Dateien vom Einsammeln. Unveränderte Kopien lassen sich neu verknüpfen.";
  return null;
}

/** Leiste über den Schritten, solange etwas fehlt oder verändert ist. */
export function OriginalsBanner({ view, onOpen }: { view: SessionView; onOpen: () => void }) {
  const text = originalsSummary(view.rows);
  if (!text) return null;
  return (
    <div
      className="mx-6 mt-3 flex items-start gap-3 rounded-lg bg-warn-soft px-3 py-2 text-[0.9rem]"
      role="status"
      data-testid="originals-banner"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-warn">{text}</p>
        <p className="mt-0.5 max-w-[78ch] text-ink-2">{originalsDetail(view.rows)}</p>
      </div>
      <Button size="sm" onClick={onOpen} className="shrink-0">
        Originale suchen…
      </Button>
    </div>
  );
}

/** Fortschritt aus dem Hauptprozess, nur für diesen Einsatz. */
function useOriginalsProgress(sessionId: string): [OriginalsProgress | null, (p: OriginalsProgress | null) => void] {
  const [p, setP] = useState<OriginalsProgress | null>(null);
  useEffect(() => api.onOriginalsProgress((x) => x.sessionId === sessionId && setP(x)), [sessionId]);
  return [p, setP];
}

/** Fortschritt in Worten: Ordner durchsuchen (Gesamtzahl unbekannt) oder Prüfsummen rechnen. */
function progressText(p: OriginalsProgress | null): string {
  if (!p) return "Wird vorbereitet…";
  if (p.phase === "suchen") return `${p.done} Dateien durchsucht…`;
  if (!p.total) return `Prüfsumme: ${p.fileName}`;
  return `Prüfsummen ${Math.min(p.done + 1, p.total)} von ${p.total}${p.fileName ? `: ${p.fileName}` : ""}`;
}

/** Ergebnis von „Ordner durchsuchen…“ als Satz. */
function searchText(r: OriginalsSearch): string {
  if (!r.relinked.length && !r.stillOpen.length) return "Es fehlt nichts mehr.";
  const parts: string[] = [];
  parts.push(
    r.relinked.length
      ? `${r.relinked.length} neu verknüpft (${r.relinked.map((x) => x.label).join(", ")}).`
      : "Keine passende Datei gefunden.",
  );
  if (r.stillOpen.length) parts.push(`Weiter offen: ${r.stillOpen.join(", ")}.`);
  if (r.truncated) parts.push(`Die Suche hat nach ${r.scanned} Dateien aufgehört; bitte einen engeren Ordner wählen.`);
  return parts.join(" ");
}

/**
 * Dialog „Originaldateien“: alle Quellen des Einsatzes mit Zustand und Pfad, auffällige zuerst. Drei Wege: einen
 * Ordner nach allen fehlenden durchsuchen, alle Prüfsummen neu rechnen oder für eine Datei den neuen Platz wählen.
 */
export function OriginalsDialog({
  view,
  open,
  onOpenChange,
  onView,
  guard,
}: {
  view: SessionView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onView: (v: SessionView) => void;
  guard: Guard;
}) {
  const sessionId = view.session.id;
  const [busy, setBusy] = useState<"check" | "search" | null>(null);
  const [progress, setProgress] = useOriginalsProgress(sessionId);
  const [search, setSearch] = useState<OriginalsSearch | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setSearch(null);
    }
  }

  const run = async (kind: "check" | "search", fn: () => Promise<void>) => {
    setBusy(kind);
    setProgress(null);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const checkAll = () =>
    run("check", async () => {
      // Die Prüfung liefert nur ihr Ergebnis; den neuen Zustand der Dateien bringt erst die frisch geholte Ansicht.
      if (!(await guard(() => api.checkOriginals(sessionId, true)))) return;
      const v = await guard(() => api.getSession(sessionId));
      if (v) onView(v);
    });
  const searchFolder = () =>
    run("search", async () => {
      const r = await guard(() => api.searchOriginals(sessionId));
      if (!r) return;
      onView(r.view);
      setSearch(r.result);
    });
  const pick = (id: string) =>
    void guard(() => api.relinkOriginal(id)).then((v) => {
      if (v) onView(v);
    });

  const rows = view.rows.toSorted(
    (a, b) => Number(needsRelink(b)) - Number(needsRelink(a)) || a.label.localeCompare(b.label),
  );
  const open_ = rows.filter(needsRelink);
  const unchecked = rows.filter((r) => r.file === "unchecked").length;
  const summary = originalsSummary(rows);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(760px,94vw)] -translate-1/2 flex-col rounded-xl border border-line bg-panel p-5 shadow-2xl"
          data-testid="originals-dialog"
        >
          <div className="mb-1 flex items-center">
            <Dialog.Title className="text-base font-semibold">Originaldateien</Dialog.Title>
            <span className="flex-1" />
            <CloseButton onClick={() => onOpenChange(false)} />
          </div>
          <Dialog.Description className="mb-3 text-[0.86rem] text-muted">
            Feldspur liest die Originale an ihrem Platz und verändert sie nie. Ein neuer Pfad wird nur übernommen, wenn
            die Prüfsumme (SHA-256) zu der beim Einsammeln passt; ein gleicher Dateiname genügt nicht. Jede
            Neuverknüpfung steht im Änderungsprotokoll.
          </Dialog.Description>
          <ErrorBanner dialog className="mb-3" />

          <p className="mb-2 font-serif text-[1.05rem]" data-testid="originals-summary">
            {summary ??
              (unchecked
                ? `Alle Originale sind da. Bei ${unchecked === 1 ? "einer Datei ist" : `${unchecked} Dateien ist`} die Prüfsumme noch nicht geprüft.`
                : "Alle Originale sind da und unverändert.")}
          </p>
          {search && (
            <div className="mb-2 rounded-lg bg-accent-soft px-3 py-1.5 text-[0.9rem]" data-testid="originals-search">
              {searchText(search)}
              {search.rejected.length > 0 && (
                <ul className="mt-1 text-[0.84rem]">
                  {search.rejected.map((x) => (
                    <li key={`${x.label}${x.path}`}>
                      {x.label}: <span className="break-all">{x.path}</span> nicht übernommen, {x.reason}.
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              variant={open_.length ? "primary" : "default"}
              disabled={!!busy || !open_.length}
              onClick={() => void searchFolder()}
            >
              {busy === "search" ? "Sucht…" : "Ordner durchsuchen…"}
            </Button>
            <Button disabled={!!busy} onClick={() => void checkAll()}>
              {busy === "check" ? "Prüft…" : "Alle Prüfsummen prüfen"}
            </Button>
            {busy && <span className="text-[0.85rem] text-muted tabular-nums">{progressText(progress)}</span>}
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line" data-testid="originals-list">
            {rows.map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line px-3 py-2 last:border-b-0"
                data-testid="originals-row"
              >
                <Glyph kind={r.kind} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <b className="font-semibold">{r.label}</b>
                    <span className="truncate text-[0.9rem]">{r.fileName}</span>
                    <span className={cx("ml-auto flex-none text-[0.84rem]", FILE_STATE_CLASS[r.file])}>
                      {FILE_STATE_TEXT[r.file]}
                    </span>
                  </div>
                  <div className="truncate text-[0.8rem] text-muted [direction:rtl]" title={r.originalPath}>
                    {"‎"}
                    {r.originalPath}
                  </div>
                  {needsRelink(r) && <div className="text-[0.8rem] text-muted">{r.fileDetail}</div>}
                </div>
                {needsRelink(r) ? (
                  <Button size="sm" disabled={!!busy} onClick={() => pick(r.id)}>
                    Datei wählen…
                  </Button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
