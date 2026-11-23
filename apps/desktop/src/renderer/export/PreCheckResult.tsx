import type { OriginalsCheck, SessionView } from "../../shared/api.ts";
import { FILE_STATE_TEXT } from "../Originals.tsx";
import { Button } from "../ui.tsx";

/**
 * Was die Prüfung der Originale (erster Schritt der Ausgabe, nach der Ordnerwahl) gefunden hat. Fehlt eine Datei, die die Ausgabe braucht, geht es nicht weiter;
 * Veränderungen und fehlende, aber nicht gebrauchte Dateien lassen sich bewusst übergehen.
 */
export function PreCheckResult({
  view,
  result,
  parent,
  onOriginals,
  onContinue,
  onCancel,
}: {
  view: SessionView;
  result: OriginalsCheck;
  /** Schon gewählter Ordner: „Trotzdem ausgeben“ geht ohne Nachfrage dorthin. */
  parent: string;
  onOriginals: () => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const byId = new Map(view.rows.map((r) => [r.id, r]));
  const detail = new Map(result.checks.map((c) => [c.sourceId, c]));
  const line = (id: string) => {
    const r = byId.get(id);
    const c = detail.get(id);
    return (
      <li key={id}>
        <b className="font-mono font-semibold">{r?.label ?? "?"}</b> {r?.fileName}:{" "}
        {c ? `${FILE_STATE_TEXT[c.state]} (${c.detail})` : ""}
      </li>
    );
  };
  const blocked = result.blocking.length > 0;
  return (
    <section
      className="mt-5 rounded-lg bg-warn-soft px-3 py-2.5 text-[0.9rem]"
      role="alert"
      data-testid="export-originals"
    >
      {blocked ? (
        <>
          <b className="block font-semibold text-bad">
            {result.blocking.length === 1
              ? "Feldspur findet eine Originaldatei nicht, ohne sie geht die Ausgabe nicht"
              : `Feldspur findet ${result.blocking.length} Originaldateien nicht, ohne sie geht die Ausgabe nicht`}
          </b>
          <ul className="my-1 grid gap-0.5 text-[0.86rem]">{result.blocking.map(line)}</ul>
        </>
      ) : null}
      {result.warnings.length > 0 && (
        <>
          <b className={`block font-semibold text-warn ${blocked ? "mt-2" : ""}`}>
            {blocked ? "Außerdem" : "Auffällig, die Ausgabe geht trotzdem"}
          </b>
          <ul className="my-1 grid gap-0.5 text-[0.86rem]">{result.warnings.map(line)}</ul>
          <p className="text-[0.84rem] text-muted">
            Verändert heißt: Die Datei ist nicht mehr die beim Einsammeln. Das Begleitprotokoll nennt die Prüfsumme vom
            Einsammeln.
          </p>
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant={blocked ? "primary" : "default"} onClick={onOriginals}>
          Originale suchen…
        </Button>
        {!blocked && (
          <Button size="sm" onClick={onContinue} title={`Ausgeben nach: ${parent}`} data-testid="export-anyway">
            Trotzdem ausgeben
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </section>
  );
}
