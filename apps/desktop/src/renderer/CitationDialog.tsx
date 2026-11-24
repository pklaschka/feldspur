/**
 * Dialog „Feldspur zitieren“ (Issue #163): fertige Quellenangabe für genau die laufende Version. Zunächst mit der DOI
 * für alle Versionen; die DOI dieser Version schlägt Feldspur nur auf Knopfdruck bei Zenodo nach und merkt sie sich.
 *
 * Geöffnet aus der Fußzeile der linken Spalte (`app/footer.tsx`). Den Text des Zitats baut
 * `apps/desktop/src/shared/citation.ts`; nachgeschlagen und gemerkt wird im Hauptprozess
 * (`apps/desktop/src/main/citation.ts`).
 */
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CitationInfo } from "../shared/api.ts";
import {
  ALL_VERSIONS_DOI,
  citationParts,
  citationText,
  doiUrl,
  FORMAT_LABEL,
  SOFTWARE_LICENSE,
  type CitationFormat,
} from "../shared/citation.ts";
import { Button, Choice, CloseButton, cx } from "./ui.tsx";

const api = window.feldspur;

/**
 * Zustand des Hinweiskastens unter dem Zitat: `idle` (noch nicht nachgeschlagen), `loading`, `found` (DOI dieser
 * Version eingesetzt), `offline` (Zenodo nicht erreichbar), `missing` (Version dort noch nicht verzeichnet).
 */
export type LookupState = "idle" | "loading" | "found" | "offline" | "missing";

const monthYear = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
const day = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { dateStyle: "medium" });

export function CitationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [info, setInfo] = useState<CitationInfo | null>(null);
  const [format, setFormat] = useState<CitationFormat>("apa");
  const [lookup, setLookup] = useState<LookupState>("idle");
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const copyRef = useRef<HTMLButtonElement>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setCopied(null);
      setLookup("idle");
    }
  }
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api.citationInfo().then((i) => {
      if (!live) return;
      setInfo(i);
      if (i.versionDoi) setLookup("found");
    });
    return () => {
      live = false;
      // Schließen bricht ein laufendes Nachschlagen ab.
      void api.cancelCitationLookup();
    };
  }, [open]);

  const runLookup = async () => {
    setLookup("loading");
    const r = await api.lookupCitationDoi();
    if (r.state === "found") {
      setInfo((i) => i && { ...i, versionDoi: r.versionDoi });
      setLookup("found");
      // Was vorher kopiert wurde, trägt noch die DOI für alle Versionen.
      setCopied(null);
      copyRef.current?.focus();
    } else if (r.state === "cancelled") setLookup("idle");
    else setLookup(r.state);
  };

  // Solange die DOI dieser Version nicht bekannt ist, steht die für alle Versionen im Zitat.
  const doi = info?.versionDoi?.doi ?? ALL_VERSIONS_DOI;
  const input = info && { version: info.version, released: info.released, doi };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(720px,94vw)] -translate-1/2 flex-col overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-2xl"
          data-testid="citation-dialog"
        >
          <div className="mb-1 flex items-center">
            <Dialog.Title className="text-base font-semibold">Feldspur zitieren</Dialog.Title>
            <span className="flex-1" />
            <CloseButton onClick={() => onOpenChange(false)} />
          </div>
          <Dialog.Description className="mb-4 text-[0.9rem] text-muted">
            Hast du Material mit Feldspur aufbereitet, nenne das Programm mit der Version, die du verwendet hast.
          </Dialog.Description>
          {info && input && (
            <>
              <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
                {(
                  [
                    ["Version", info.version],
                    ["Erschienen", monthYear(info.released)],
                    ["Lizenz", SOFTWARE_LICENSE],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[0.75rem] tracking-wide text-muted uppercase">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <Choice
                label="Format des Zitats"
                value={format}
                onChange={(f) => {
                  setFormat(f);
                  setCopied(null);
                }}
                options={(Object.keys(FORMAT_LABEL) as CitationFormat[]).map((f) => ({
                  value: f,
                  label: FORMAT_LABEL[f],
                }))}
              />
              <p
                className={cx(
                  "mt-3 rounded-lg border border-line bg-panel-2 px-4 py-3 leading-relaxed select-text [overflow-wrap:anywhere]",
                  format === "apa"
                    ? "font-serif text-[1rem]"
                    : "font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[0.82rem] whitespace-pre-wrap",
                )}
                data-testid="citation-text"
              >
                {citationParts(format, input).map((p, i) =>
                  p.doi ? (
                    <mark
                      key={i}
                      className={cx(
                        "rounded font-medium text-ink",
                        format === "apa" && "px-1 font-sans",
                        info.versionDoi ? "bg-accent-soft" : "bg-line",
                      )}
                    >
                      {p.text}
                    </mark>
                  ) : p.italic ? (
                    <i key={i}>{p.text}</i>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </p>
              <Notice info={info} state={lookup} onLookup={() => void runLookup()} />
              <div className="mt-4 flex items-center justify-end gap-3">
                {/* Immer da, damit Screenreader die Meldung ansagen; nur der Text wechselt. */}
                <span
                  role="status"
                  className={cx("text-[0.9rem] font-medium", copied === "failed" ? "text-bad" : "text-good")}
                >
                  {copied === "ok" && (
                    <>
                      <span aria-hidden>✓ </span>Kopiert
                    </>
                  )}
                  {copied === "failed" && "Kopieren hat nicht geklappt. Markiere den Text und kopiere ihn von Hand."}
                </span>
                <Button
                  ref={copyRef}
                  variant={lookup === "found" ? "primary" : "default"}
                  onClick={() =>
                    void api.copyText(citationText(format, input)).then(
                      () => setCopied("ok"),
                      () => setCopied("failed"),
                    )
                  }
                >
                  Zitat kopieren
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const TONE = {
  warn: "border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-warn-soft",
  good: "border-[color-mix(in_srgb,var(--good)_35%,transparent)] bg-[color-mix(in_srgb,var(--good)_12%,var(--panel))]",
  plain: "border-line bg-panel-2",
};
const MARK = { warn: "bg-warn", good: "bg-good", plain: "bg-muted" };

/** Hinweiskasten unter dem Zitat: sagt, welche DOI im Zitat steht, und bietet das Nachschlagen bei Zenodo an. */
function Notice({ info, state, onLookup }: { info: CitationInfo; state: LookupState; onLookup: () => void }) {
  const v = info.version;
  const zenodoLink = (label: string, url: string) => (
    <Button variant="link" onClick={() => void api.openCitationLink(url)}>
      {label}
      <span aria-hidden> ↗</span>
      <span className="sr-only"> (öffnet im Browser)</span>
    </Button>
  );
  let tone: keyof typeof TONE = "plain";
  let mark = "i";
  let title: string;
  let body: ReactNode = null;
  let actions: ReactNode = null;
  if (state === "found" && info.versionDoi) {
    tone = "good";
    mark = "✓";
    title = `DOI von Version ${v} eingesetzt.`;
    body = `Nachgeschlagen am ${day(info.versionDoi.checkedAt)}. Feldspur merkt sie sich und fragt Zenodo nicht noch einmal.`;
    actions = zenodoLink(`Version ${v} auf Zenodo ansehen`, info.versionDoi.url);
  } else if (state === "loading") {
    mark = "";
    title = "Feldspur schlägt bei Zenodo nach…";
    actions = (
      <Button size="sm" onClick={() => void api.cancelCitationLookup()}>
        Nachschlagen abbrechen
      </Button>
    );
  } else if (state === "offline") {
    tone = "warn";
    mark = "!";
    title = "Zenodo ist nicht erreichbar.";
    body =
      "Prüfe die Internetverbindung oder versuche es später noch einmal. Das Zitat oben stimmt trotzdem: Es nennt die Version und die DOI für alle Versionen.";
    actions = (
      <Button size="sm" onClick={onLookup}>
        Erneut nachschlagen
      </Button>
    );
  } else if (state === "missing") {
    title = `Version ${v} steht noch nicht auf Zenodo.`;
    body =
      "Nach dem Erscheinen einer Version dauert das einige Minuten. Bis dahin stimmt das Zitat oben trotzdem: Es nennt die Version und die DOI für alle Versionen.";
    actions = (
      <Button size="sm" onClick={onLookup}>
        Erneut nachschlagen
      </Button>
    );
  } else {
    tone = "warn";
    mark = "!";
    title = "Im Zitat steht die DOI für alle Versionen.";
    body = (
      <>
        Genauer ist die DOI von Version {v}. Feldspur kann sie bei Zenodo nachschlagen und ins Zitat einsetzen.
        <span className="mt-1 block text-[0.82rem] text-muted">
          Feldspur ruft dafür die Versionsliste von zenodo.org ab. Aus deinem Projekt wird nichts übertragen.
        </span>
      </>
    );
    actions = (
      <>
        <Button variant="primary" size="sm" onClick={onLookup}>
          DOI bei Zenodo nachschlagen
        </Button>
        {zenodoLink("Selbst auf Zenodo nachsehen", doiUrl(ALL_VERSIONS_DOI))}
      </>
    );
  }
  return (
    <div
      className={cx("mt-3 flex gap-3 rounded-lg border px-4 py-3 text-[0.9rem]", TONE[tone])}
      data-testid="citation-notice"
    >
      {mark ? (
        <span
          aria-hidden
          className={cx(
            "mt-0.5 grid size-5 flex-none place-items-center rounded-full text-[0.75rem] font-bold text-panel",
            MARK[tone],
          )}
        >
          {mark}
        </span>
      ) : (
        <span
          aria-hidden
          className="mt-0.5 size-5 flex-none animate-spin rounded-full border-2 border-line-2 border-t-muted motion-reduce:animate-none"
        />
      )}
      <div className="min-w-0 flex-1">
        {/* Nur Überschrift und Text werden angesagt, nicht bei jedem Wechsel auch die Knöpfe. */}
        <div role="status">
          <p className="font-semibold">{title}</p>
          {body && <div className="mt-0.5 text-ink-2">{body}</div>}
        </div>
        {actions && <div className="mt-2.5 flex flex-wrap items-center gap-4">{actions}</div>}
      </div>
    </div>
  );
}
