/**
 * „Ordner prüfen…“ (Issue #208): einen Ausgabeordner gegen seine Prüfsummenliste testen, etwa nach dem Kopieren auf
 * ein Archivlaufwerk oder Jahre später. Sitzt unter der letzten Ausgabe im Schritt „Ausgeben“
 * (`ExportResult.tsx`); die Prüfung selbst läuft im Hauptprozess (`verifyFolder` in
 * `packages/media/src/originals-copy.ts`).
 */
import { useEffect, useState } from "react";
import type { FolderCheck, FolderCheckProgress } from "../../shared/api.ts";
import { someLabels } from "../format.ts";
import { Button } from "../ui.tsx";
import { checkedText, fileName } from "./text.ts";

const api = window.feldspur;

/** Meldung aus dem Hauptprozess ohne Electrons Vorspann „Error invoking remote method …“. */
const message = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export function FolderCheckButton({ dir }: { /** Vorgabe im Dialog: der Ordner der letzten Ausgabe. */ dir: string }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<FolderCheckProgress | null>(null);
  const [result, setResult] = useState<FolderCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => api.onFolderCheckProgress(setProgress), []);

  const start = () => {
    setRunning(true);
    setProgress(null);
    setResult(null);
    setError(null);
    void api
      .checkFolder(dir)
      .then(setResult, (e: unknown) => setError(message(e)))
      .finally(() => setRunning(false));
  };

  return (
    <div className="mt-3 border-t border-line pt-2.5" data-testid="folder-check">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" disabled={running} onClick={start}>
          Ordner prüfen…
        </Button>
        {running ? (
          <>
            <span className="text-[0.85rem] text-muted tabular-nums" role="status">
              {progress && progress.total > 0 ? checkedText(progress) : "Prüft…"}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void api.cancelFolderCheck()}>
              Abbrechen
            </Button>
          </>
        ) : (
          <span className="text-[0.85rem] text-muted">
            Zeigt, ob ein Ausgabeordner noch so ist, wie Feldspur ihn geschrieben hat, auch eine Kopie im Archiv.
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[0.88rem] text-bad">
          {error}
        </p>
      )}
      {result && <FolderCheckResult result={result} />}
    </div>
  );
}

/** Ergebnis: ein Satz, wenn alles stimmt; sonst was fehlt, was verändert ist und was dazugekommen ist. */
function FolderCheckResult({ result }: { result: FolderCheck }) {
  const { missing, changed, extra, ok, listed } = result;
  const bad = missing.length + changed.length > 0;
  const where = `„${fileName(result.dir)}“`;
  return (
    <div
      className={bad ? "mt-2 rounded-lg bg-bad/8 px-3 py-2.5" : "mt-2"}
      role="status"
      data-testid="folder-check-result"
      data-state={bad ? "bad" : "ok"}
    >
      {bad ? (
        <b className="block text-[0.9rem] font-semibold text-bad">
          {where}: {ok} von {listed} Dateien unverändert
        </b>
      ) : (
        <p className="text-[0.9rem] font-medium text-good">
          <span aria-hidden>✓ </span>
          {where}: alle {listed} Dateien unverändert.
        </p>
      )}
      <ul className="mt-1 grid gap-0.5 text-[0.88rem]">
        {missing.length > 0 && <Row head="Fehlen" files={missing} />}
        {changed.length > 0 && <Row head="Verändert" files={changed} />}
        {extra.length > 0 && <Row head="Nicht in der Prüfsummenliste (später dazugelegt?)" files={extra} muted />}
      </ul>
    </div>
  );
}

function Row({ head, files, muted }: { head: string; files: string[]; muted?: boolean }) {
  return (
    <li className={muted ? "text-muted" : undefined}>
      <span className="font-medium">{head}:</span>{" "}
      <span className="break-all" title={files.join("\n")}>
        {someLabels(files)}
      </span>
    </li>
  );
}
