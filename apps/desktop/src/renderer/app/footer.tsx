/** Fuß der Einsatzliste: laufende Version und „Zitieren…“ (Issue #163). */
import { useEffect, useState } from "react";
import { CitationDialog } from "../CitationDialog.tsx";

const api = window.feldspur;

export function AppFooter() {
  const [version, setVersion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void api.citationInfo().then((i) => live && setVersion(i.version));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="sticky bottom-0 mt-auto -mx-2.5 flex items-center gap-2 border-t border-rail-hover bg-rail px-4.5 py-3">
      <span className="min-w-0 flex-1 text-[0.86rem] text-rail-muted tabular-nums" data-testid="app-version">
        {version && (
          <>
            Feldspur <span className="whitespace-nowrap">{version}</span>
          </>
        )}
      </span>
      <button
        className="cursor-pointer rounded-lg border border-rail-muted/50 px-2.5 py-0.5 text-[0.86rem] text-rail-ink hover:bg-rail-hover focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => setOpen(true)}
      >
        Zitieren…
      </button>
      <CitationDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
