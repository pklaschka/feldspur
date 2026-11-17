import type { SessionView, SourceRow } from "../../shared/api.ts";
import { Button } from "../ui.tsx";
import type { InspectorActions } from "./actions.ts";
import { checkReason } from "./status.ts";

/**
 * Lage mit Status „prüfen“: erklären, warum, und den Weg zu „geprüft“ anbieten.
 * Bestätigte Lagen zeigen, dass sie von Hand geprüft wurden, und lassen sich zurücknehmen.
 */
export function CheckPanel({ row, view, actions }: { row: SourceRow; view: SessionView; actions: InspectorActions }) {
  const checked = row.evidence.find((e) => e.kind === "checked" && e.chosen);
  if (checked) {
    return (
      <div className="mt-3.5 flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[0.86rem]">
        <span className="text-good" aria-hidden>
          ✓
        </span>
        <span className="flex-1">Von Hand geprüft: Die Lage passt.</span>
        <Button variant="link" className="text-[0.85rem]" onClick={() => actions.removeEvidence(checked.id)}>
          Zurücknehmen
        </Button>
      </div>
    );
  }
  if (row.status !== "check" || row.startMs === null) return null;
  // Tagebuchseiten werden über ihre Einträge geprüft, weitere Bilder über die Hauptseite.
  if (row.kind === "diary" || row.partOf) return null;
  const device = view.devices.find((d) => d.id === row.deviceId);
  const hasRef = view.devices.some((d) => d.isReference);
  // Nur anbieten, wenn die Lage wirklich an der Geräteuhr hängt (nicht bei einer Handeingabe).
  const unknownClock =
    !!device && !device.isReference && device.offsetMs === null && row.notes.includes("Uhr weicht ab?");
  const deviceFiles = device ? view.rows.filter((r) => r.deviceId === device.id && !r.partOf).length : 0;
  const reasons = row.notes.map((n) => checkReason(n, device?.label));
  return (
    <section
      className="mt-3.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-[0.88rem]"
      data-testid="check-panel"
      aria-label="Lage prüfen"
    >
      <b className="block font-semibold text-warn">Lage prüfen</b>
      {reasons.length > 0 && (
        <ul className="mt-1 list-disc pl-4.5">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="mt-1">
        {row.kind === "audio" || row.kind === "video"
          ? "Hör kurz hinein oder vergleiche mit den Nachbarspuren."
          : "Vergleiche mit den Nachbarspuren."}{" "}
        Passt die Lage, bestätige sie hier.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Ohne Referenzuhr ist erst die Uhr dran; „Lage passt“ wäre dann ein voreiliger Klick. */}
        <Button
          size="sm"
          variant={hasRef ? "primary" : "default"}
          onClick={() => actions.confirm(row.id, row.startMs!)}
        >
          ✓ Lage passt, als geprüft markieren
        </Button>
        {unknownClock && hasRef && (
          <Button
            size="sm"
            className="!whitespace-normal text-left"
            onClick={() => actions.trustDeviceClock(device.id)}
            title="Die Uhr des Geräts ging richtig (Abweichung 0). Alle Dateien des Geräts gelten dann als sicher."
          >
            Uhr von {device.label} stimmt ({deviceFiles} {deviceFiles === 1 ? "Datei" : "Dateien"})
          </Button>
        )}
        {device && !hasRef && (
          <Button size="sm" className="!whitespace-normal text-left" onClick={() => actions.setReference(device.id)}>
            {device.label} als Referenzuhr
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-[0.82rem] text-muted">Passt sie nicht: unten bei Zeitbelege eine Uhrzeit eintragen.</p>
    </section>
  );
}
