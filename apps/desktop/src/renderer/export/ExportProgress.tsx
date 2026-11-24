/**
 * Fortschritt einer laufenden Ausgabe im Schritt „Ausgeben“. Den Stand (`ExportJob`) hält
 * `apps/desktop/src/renderer/exportState.tsx` oberhalb der Schritte, damit er einen Wechsel des Schritts oder des
 * Einsatzes übersteht.
 */
import { CHECK_STEP, percent, remainingMs, remainingText, type ExportJob } from "../exportState.tsx";
import { Button } from "../ui.tsx";
import { checkedText } from "./text.ts";

/** Laufende Ausgabe: Schritt, Rest, Fortschrittsbalken und Abbrechen. */
export function ExportProgress({ job, onCancel }: { job: ExportJob; onCancel: () => void }) {
  const progress = job.progress;
  const pct = percent(progress, job.video);
  return (
    <div data-testid="export-progress">
      <div className="mb-1 flex items-center gap-3 text-[0.9rem]">
        <span>{job.cancelling ? "Bricht ab…" : (progress?.step ?? "Vorbereiten")}</span>
        <span className="flex-1" />
        <span className="text-muted tabular-nums">
          {progress?.step === "Montagevideo" && !job.cancelling && `${remainingText(remainingMs(job))} · `}
          {progress?.step === CHECK_STEP && !job.cancelling && `${checkedText(progress)} · `}
          {pct} %
        </span>
        <Button size="sm" disabled={job.cancelling} onClick={onCancel} data-testid="export-cancel">
          Abbrechen
        </Button>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-label="Ausgabe"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${progress?.step ?? "Vorbereiten"}, ${pct} %`}
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[0.85rem] text-muted">
        {progress?.step === CHECK_STEP || !progress
          ? "Zuerst prüft Feldspur, ob die Originale noch dieselben sind wie beim Einsammeln (schon geprüfte merkt es sich). "
          : ""}
        Du kannst weiterarbeiten oder den Schritt wechseln, die Ausgabe läuft weiter. Änderungen ab jetzt kommen in die
        nächste Ausgabe.
      </p>
    </div>
  );
}
