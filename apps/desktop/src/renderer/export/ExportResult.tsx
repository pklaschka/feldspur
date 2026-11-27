/**
 * Letzte Ausgabe eines Einsatzes: Beleg-Karte, solange sie aktuell ist, sonst was sich geändert hat. Teil des
 * Schritts „Ausgeben“ (`apps/desktop/src/renderer/ExportStep.tsx`); den Stand (`ExportStatus`) lädt `useExportStatus`
 * (`apps/desktop/src/renderer/export/hooks.ts`), verglichen wird in `packages/media/src/export-state.ts`.
 */
import { useState } from "react";
import type { ExportCard, ExportStatus } from "../../shared/api.ts";
import { someLabels } from "../format.ts";
import { Button } from "../ui.tsx";
import { ExportReceipt } from "./ExportReceipt.tsx";
import { FolderCheckButton } from "./FolderCheck.tsx";
import { FILE_ROLE, fileName, files, inDir, isCopy, parentDir, when } from "./text.ts";

const api = window.feldspur;

/** „Erneut ausgeben“ geht in den bisherigen Ordner; der zweite Knopf fragt nach einem anderen. */
function RerunButtons({
  disabled,
  dir,
  onRerun,
  onRerunElsewhere,
}: {
  disabled: boolean;
  dir: string;
  onRerun: () => void;
  onRerunElsewhere: () => void;
}) {
  return (
    <>
      <Button size="sm" disabled={disabled} onClick={onRerun} title={`Ausgeben nach: ${parentDir(dir)}`}>
        Erneut ausgeben
      </Button>
      <Button size="sm" disabled={disabled} onClick={onRerunElsewhere}>
        In anderen Ordner ausgeben…
      </Button>
    </>
  );
}

/**
 * Letzte Ausgabe: wann, wohin, welche Dateien, und ob sie noch zum Einsatz passt. Passt sie nicht, steht dabei,
 * was sich geändert hat, damit niemand eine veraltete Fassung in MAXQDA weiterverwendet.
 */
export function ExportResult({
  status,
  card,
  fresh,
  disabled,
  onRerun,
  onRerunElsewhere,
}: {
  status: ExportStatus;
  /** Zahlen für die Beleg-Karte; null, solange sie lädt oder wenn die Ausgabe veraltet ist. */
  card: ExportCard | null;
  /** Eben erst fertig geworden, nicht beim Wiederkommen. */
  fresh: boolean;
  /** Erneut ausgeben sperren: solange eine Ausgabe läuft oder nach der Prüfung der Originale angehalten ist. */
  disabled: boolean;
  onRerun: () => void;
  onRerunElsewhere: () => void;
}) {
  const { record, differences, missingFiles } = status;
  const stale = differences.length > 0;
  const gone = new Set(missingFiles);
  // Eine Datei, die noch dort liegt: „Im Ordner zeigen“ markiert sie; sonst öffnet es nur den Ordner.
  const present = record.files.find((f) => !gone.has(f));
  // Der Viewer ist die .html, die nicht die LIESMICH ist; nur anbieten, wenn er noch im Ordner liegt.
  const viewerFile = record.files.find((f) => f.endsWith(".html") && !/^LIESMICH\.html$/.test(f) && !gone.has(f));
  const [listOpen, setListOpen] = useState(false);
  const showFolder = () => void api.showInFolder(present ? inDir(record.dir, present) : record.dir);
  // Liegt keine der Dateien mehr dort, ist meist der ganze Ordner verschoben: ein Satz statt lauter Streichungen.
  const allGone = record.files.length > 0 && missingFiles.length === record.files.length;
  // Kopien der Originale (Issue #208) als ein Eintrag „Originale/“ statt hunderter Zeilen.
  const copies = record.files.filter(isCopy);
  const goneCopies = copies.filter((f) => gone.has(f)).length;
  const fileList = allGone ? (
    <p className="mt-3 text-[0.9rem]" id={`export-files-${record.sessionId}`} data-testid="export-files">
      <span className="font-medium text-bad">
        Feldspur findet {record.files.length === 1 ? "die Datei" : `keine der ${files(record.files.length)}`} mehr im
        Ordner.
      </span>{" "}
      <span className="text-muted">
        Vermutlich wurde der Ordner „{fileName(record.dir)}“ verschoben, umbenannt oder gelöscht.
      </span>
    </p>
  ) : (
    <ul className="mt-3 grid gap-1.5" id={`export-files-${record.sessionId}`} data-testid="export-files">
      {record.files
        .filter((f) => !isCopy(f))
        .map((f) => (
          <li key={f} className="text-[0.9rem]">
            <span className={`font-medium break-all ${gone.has(f) ? "text-muted line-through" : ""}`}>{f}</span>
            {gone.has(f) && <span className="ml-2 text-[0.85rem] text-bad">fehlt im Ordner</span>}
            <span className="block text-[0.85rem] text-muted">{FILE_ROLE.find(([re]) => re.test(f))?.[1] ?? ""}</span>
          </li>
        ))}
      {copies.length > 0 && (
        <li className="text-[0.9rem]" data-testid="export-files-originals">
          <span className="font-medium">Originale/</span>
          <span className="ml-2 text-[0.85rem] text-muted">{files(copies.length)}</span>
          {goneCopies > 0 && <span className="ml-2 text-[0.85rem] text-bad">{goneCopies} fehlen im Ordner</span>}
          <span className="block text-[0.85rem] text-muted">
            {FILE_ROLE.find(([re]) => re.test("Originale/"))?.[1] ?? ""}
          </span>
        </li>
      )}
    </ul>
  );
  const missingNotice = missingFiles.length > 0 && (
    <div className="mt-3 rounded-lg bg-warn/8 px-3 py-2.5" role="status" data-testid="export-incomplete">
      <b className="block text-[0.9rem] font-semibold text-warn">
        {missingFiles.length === 1
          ? "Eine Datei fehlt im Ausgabeordner"
          : `${missingFiles.length} Dateien fehlen im Ausgabeordner`}
      </b>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <RerunButtons disabled={disabled} dir={record.dir} onRerun={onRerun} onRerunElsewhere={onRerunElsewhere} />
        <span className="text-[0.85rem] text-muted">Verschoben oder gelöscht? Das legt sie wieder an.</span>
      </div>
    </div>
  );

  if (!stale)
    return (
      <div data-testid="export-result" data-state="current">
        <ExportReceipt
          record={record}
          card={card}
          fresh={fresh}
          viewerFile={viewerFile}
          filesOpen={listOpen || missingFiles.length > 0}
          onToggleFiles={() => setListOpen((o) => !o)}
          onShowFolder={showFolder}
        >
          {missingNotice}
          {(listOpen || missingFiles.length > 0) && fileList}
          {!missingFiles.length && (
            <p className="mt-3 border-t border-line pt-2.5 text-[0.85rem] text-muted">
              Änderst du danach noch etwas, steht hier „Veraltet“, auch nach einem Neustart. Erneut ausgeben rechnet nur
              Geändertes neu.
            </p>
          )}
          <FolderCheckButton dir={record.dir} />
        </ExportReceipt>
      </div>
    );

  return (
    <div data-testid="export-result" data-state="stale">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[1.1rem] leading-snug">
            <span className="text-warn">Veraltet.</span> {allGone ? "Die Ausgabe lag" : files(record.files.length)} im
            Ordner „{fileName(record.dir)}“
          </p>
          <p className="text-[0.85rem] text-muted">Ausgegeben am {when(record.exportedAt)}</p>
        </div>
        {!allGone && (
          <Button size="sm" className="shrink-0" onClick={showFolder}>
            Im Ordner zeigen
          </Button>
        )}
      </div>
      <div className="mt-3 rounded-lg bg-warn/8 px-3 py-2.5" role="status" data-testid="export-stale">
        <b className="block text-[0.9rem] font-semibold text-warn">Passt nicht mehr zum Einsatz</b>
        <ul className="mt-1 grid list-disc gap-0.5 pl-5 text-[0.88rem]" data-testid="export-differences">
          {differences.map((d) => (
            <li key={d.kind}>
              {d.text}
              {d.labels?.length ? (
                <span className="ml-1.5 font-mono text-[0.82rem] text-muted" title={d.labels.join(", ")}>
                  {someLabels(d.labels)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <RerunButtons disabled={disabled} dir={record.dir} onRerun={onRerun} onRerunElsewhere={onRerunElsewhere} />
          <span className="text-[0.85rem] text-muted">Nur Geändertes wird neu gerechnet.</span>
        </div>
      </div>
      {missingFiles.length > 0 ? (
        fileList
      ) : (
        <>
          <Button
            variant="link"
            className="mt-3 text-[0.9rem]"
            aria-expanded={listOpen}
            aria-controls={`export-files-${record.sessionId}`}
            onClick={() => setListOpen((o) => !o)}
            data-testid="export-files-toggle"
          >
            {listOpen ? `${files(record.files.length)} ausblenden` : `${files(record.files.length)} anzeigen`}
          </Button>
          {listOpen && fileList}
        </>
      )}
      <FolderCheckButton dir={record.dir} />
    </div>
  );
}
