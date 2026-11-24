/**
 * Beleg-Karte im Schritt „Ausgeben“, gezeigt von `apps/desktop/src/renderer/export/ExportResult.tsx`, solange die
 * letzte Ausgabe zum Einsatz passt. Die Zahlen (`ExportCard`) zählt der Hauptprozess (`exportCard` in
 * `apps/desktop/src/main/export.ts`).
 */
import type { ReactNode } from "react";
import type { ExportCard, ExportStatus } from "../../shared/api.ts";
import { Button, cx, FlagMark } from "../ui.tsx";
import { fileName, files, germanDate, when } from "./text.ts";

const api = window.feldspur;

/**
 * Beleg-Karte einer aktuellen Ausgabe (Issue #192): der Einsatz in wenigen gezählten Tatsachen, die volle
 * Montage-ID und der Weg in den Viewer. Direkt nach der Ausgabe trägt sie den Versatzschatten aus dem
 * Infografik-Leitfaden (Zeichen für „Ergebnis“, in der App nur hier); beim Wiederkommen ist sie flach. Kein Ton,
 * keine Bewegung.
 */
export function ExportReceipt({
  record,
  card,
  fresh,
  viewerFile,
  filesOpen,
  onToggleFiles,
  onShowFolder,
  children,
}: {
  /** Vermerk der letzten Ausgabe in der Projektdatei: Ordner, Dateien, Zeitpunkt. */
  record: ExportStatus["record"];
  /** null, solange die Zahlen laden: Dann stehen nur Dateizahl und Ordner da. */
  card: ExportCard | null;
  /** Direkt nach der Ausgabe („Fertig.“, mit Schatten) statt beim Wiederkommen („Aktuell.“). */
  fresh: boolean;
  /** Dateiname des Viewers (.html) im Ausgabeordner; undefined, wenn es keinen gibt oder er dort fehlt. */
  viewerFile: string | undefined;
  filesOpen: boolean;
  onToggleFiles: () => void;
  onShowFolder: () => void;
  /** Hinweise und Dateiliste, unten in der Karte. */
  children?: ReactNode;
}) {
  const n = record.files.length;
  const facts: [string, string, string?][] = card
    ? [
        ...(card.from && card.to
          ? [
              ["Zeitraum", card.from === card.to ? `${card.from} Uhr` : `${card.from} bis ${card.to} Uhr`] as [
                string,
                string,
              ],
            ]
          : []),
        [
          "Quellen",
          `${card.sources} ${card.sources === 1 ? "Datei" : "Dateien"}` +
            (card.devices ? ` von ${card.devices} ${card.devices === 1 ? "Gerät" : "Geräten"}` : ""),
        ],
        ["Einsatztranskript", `${card.lines} ${card.lines === 1 ? "Zeile" : "Zeilen"}`],
        ["Montage-ID", card.montageId, "font-mono tracking-wide"],
      ]
    : [];
  return (
    <section
      aria-label="Ergebnis der Ausgabe"
      data-testid="export-receipt"
      data-fresh={fresh || undefined}
      className={cx(
        "relative rounded-lg border bg-panel px-5 py-4",
        fresh ? "receipt-raised border-ink/70" : "border-line-2",
      )}
    >
      <FlagMark size={20} className="absolute top-4 right-5 text-accent" />
      <p className="pr-8 font-serif text-[1.3rem] leading-snug">
        <span className="text-good">{fresh ? "Fertig." : "Aktuell."}</span>{" "}
        {!card ? (
          <>
            {files(n)} im Ordner „{fileName(record.dir)}“
          </>
        ) : fresh ? (
          <>„{card.title}“ ist ausgegeben.</>
        ) : (
          <>Die Ausgabe von „{card.title}“ passt zum jetzigen Stand.</>
        )}
      </p>
      <p className="text-[0.88rem] text-muted">
        {card && (
          <>
            {germanDate(card.date)}
            {card.place && `, ${card.place}`} ·{" "}
          </>
        )}
        ausgegeben am {when(record.exportedAt)}
      </p>
      {card && (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2" data-testid="export-receipt-facts">
          {facts.map(([label, value, cls]) => (
            <div key={label}>
              <dt className="text-[0.82rem] text-muted">{label}</dt>
              <dd className={cx("text-[0.95rem] font-semibold tabular-nums", cls)}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2">
        {viewerFile && (
          <Button
            variant="primary"
            onClick={() => void api.openExportFile(record.sessionId, viewerFile)}
            title={viewerFile}
            data-testid="export-open-viewer"
          >
            Im Viewer ansehen
          </Button>
        )}
        <Button onClick={onShowFolder}>Im Ordner zeigen</Button>
        <span className="flex-1" />
        <Button
          variant="link"
          className="text-[0.9rem]"
          aria-expanded={filesOpen}
          aria-controls={`export-files-${record.sessionId}`}
          onClick={onToggleFiles}
          data-testid="export-files-toggle"
        >
          {filesOpen ? `${files(n)} ausblenden` : `${files(n)} anzeigen`}
        </Button>
      </div>
      {children}
    </section>
  );
}
