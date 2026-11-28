/**
 * Schritt „Ansehen“ (Issue #131): die Montage so sehen wie später im Viewer (.html), bevor etwas gerechnet wird.
 * Links spielen die Originale an den Stellen, an denen sie im Montagevideo stünden, rechts läuft das
 * Einsatztranskript mit. Der Stift („Bearbeiten“) an einer Zeile führt dorthin, wo sie entsteht (Mitschreiben, Tagebuch,
 * Durchsehen, Abgleichen); zurück im Schritt steht man wieder an derselben Stelle.
 *
 * Die Ansicht ist der Viewer selbst: Der Hauptprozess baut dessen Seite in der Fassung für die App (`watchPreview`,
 * `apps/desktop/src/main/export.ts`), gezeigt wird sie in einem eigenen Rahmen (`watch.html`, `watch/frame.ts`), der
 * dasselbe Skript wie die ausgegebene Datei startet. So laufen App und Ausgabe nicht auseinander. Diese Datei hält
 * die Verbindung: Seite laden, neu laden, wenn sich der Einsatz geändert hat, Bilder liefern, Sprünge ausführen.
 * Zitiert wird nicht von hier, sondern aus der Ausgabe (kein „Stelle kopieren“).
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { EntryOrigin, SessionView, WatchPreview } from "../shared/api.ts";
import { useExportOptions } from "./export/options.ts";
import { usePlayback } from "./playback.tsx";
import { useJump, type JumpTargets } from "./SearchDialog.tsx";
import { renderImageRefJpeg } from "./stillRender.ts";
import { Button, StepHeader, Toggle } from "./ui.tsx";
import type { FromFrame, ToFrame } from "./watch/messages.ts";

const api = window.feldspur;
/**
 * Stelle in der Montage je Einsatz (Sekunden ab Beginn). Steht hier und nicht im Schritt, damit sie bleibt, wenn man
 * zum Bearbeiten in einen anderen Schritt springt oder den Einsatz wechselt; ein Neustart der App beginnt vorn.
 */
const positions = new Map<string, number>();

export function Watch({
  view,
  covered,
  jump,
  onSync,
  onNext,
}: {
  view: SessionView;
  /** Ein Fenster liegt davor (Mitschreiben, Tagebuch): solange nicht neu laden und nicht abspielen. */
  covered: boolean;
  /** Sprungziele von „Bearbeiten“, wie bei der Suche. */
  jump: JumpTargets;
  /** „Bearbeiten“ an einem Sync-Signal: Schritt „Abgleichen“ mit dieser Quelle. */
  onSync: (sourceId: string) => void;
  /** Weiter zu „Ausgeben“. */
  onNext: () => void;
}) {
  const sessionId = view.session.id;
  const [opts, setOpts] = useExportOptions();
  const withEpisodes = view.session.episodes;
  // Dieselbe Wahl wie in „Ausgeben“: Echtzeit ist der Normalfall, geschnitten wird nur auf Wunsch.
  const realtime = !(withEpisodes && opts.byEpisodes);
  const frame = useRef<HTMLIFrameElement>(null);
  /** Was der Rahmen gerade zeigt; `ready`: sein Skript wartet auf die Seite. */
  const shown = useRef<{ preview: WatchPreview | null; ready: boolean }>({ preview: null, ready: false });
  const [preview, setPreview] = useState<WatchPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = useJump(view, jump);
  const { report } = usePlayback();

  const post = (m: ToFrame, transfer: Transferable[] = []) =>
    frame.current?.contentWindow?.postMessage(m, "*", transfer);
  /** Die Seite in den wartenden Rahmen geben, an der gemerkten Stelle. */
  const show = (p: WatchPreview) => {
    shown.current = { preview: p, ready: false };
    post({
      type: "load",
      preview: p,
      levels: view.rows.map((r) => [r.id, r.level]),
      at: positions.get(sessionId) ?? 0,
    });
  };

  // Bei jedem neuen Stand des Einsatzes neu holen, aber nicht hinter einem offenen Fenster: Dort ändert sich der
  // Einsatz mit jeder Eingabe. Der Rahmen lädt nur neu, wenn sich wirklich etwas an Seite oder Ablauf geändert hat.
  useEffect(() => {
    if (covered) return;
    let live = true;
    api.watchPreview(sessionId, realtime).then(
      (p) => {
        if (!live) return;
        setError(null);
        setPreview(p);
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [view, sessionId, realtime, covered]);

  const sync = useEffectEvent(() => {
    if (!preview || preview.plan.durationMs <= 0) return;
    const cur = shown.current;
    if (cur.ready) show(preview);
    else if (cur.preview && !same(cur.preview, preview)) {
      // Der Viewer hängt sich einmal an sein Dokument: Für einen neuen Stand beginnt der Rahmen von vorn.
      shown.current = { preview: null, ready: false };
      frame.current?.contentWindow?.location.reload();
    }
  });
  useEffect(() => sync(), [preview]);

  useEffect(() => {
    if (covered) post({ type: "pause" });
  }, [covered]);

  const edit = (o: EntryOrigin) => {
    if (o.kind === "sync") return onSync(o.id);
    // Mitschreiben beginnt an der gemeldeten Stelle der Aufnahme: so öffnet es gleich an dieser Zeile.
    if (o.kind === "line") report({ sourceId: o.id, atMs: o.atMs ?? 0, playing: false });
    go({ kind: o.kind, target: o.id, atMs: o.atMs, clockMs: o.clockMs, endMs: o.endMs });
  };
  const onMessage = useEffectEvent((ev: MessageEvent<FromFrame>) => {
    if (ev.source !== frame.current?.contentWindow) return;
    const m = ev.data;
    if (m.type === "ready") {
      shown.current = { preview: null, ready: true };
      if (preview && preview.plan.durationMs > 0) show(preview);
    } else if (m.type === "at") positions.set(sessionId, m.t);
    else if (m.type === "edit") {
      const o = shown.current.preview?.origins[m.index];
      if (o) edit(o);
    } else if (m.type === "image") {
      const n = m.n;
      const ref = shown.current.preview?.images[n];
      if (!ref) return;
      void renderImageRefJpeg(ref, ref.pdf).then(
        (jpeg) => post({ type: "image", n, data: jpeg.buffer as ArrayBuffer }, [jpeg.buffer]),
        () => post({ type: "image", n, data: null }),
      );
    } else if (m.type === "key") {
      // Suche (Strg+K) und Rückgängig hören am Fenster der App; im Rahmen gedrückt, kämen sie dort nie an.
      const { key, ctrlKey, metaKey, shiftKey, altKey } = m;
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key, ctrlKey, metaKey, shiftKey, altKey, bubbles: true, cancelable: true }),
      );
    }
  });
  useEffect(() => {
    const on = (ev: MessageEvent<FromFrame>) => onMessage(ev);
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  const empty = !!preview && preview.plan.durationMs <= 0;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="watch">
      <StepHeader
        className="mb-3! px-6 pt-5"
        title="Ansehen"
        summary="So sehen Montagevideo und Viewer (.html) nach der Ausgabe aus. Hier spielen die Originale, gerechnet wird nichts."
        help={
          <>
            <p className="mb-1.5">
              Links läuft die Montage, rechts das Einsatztranskript mit. Ein Klick auf eine Zeile springt zur Stelle,
              die Zeitleiste zeigt Episoden, Fotos, Tagebucheinträge und die Aufnahmen je Gerät.
            </p>
            <p className="mb-1.5">
              Fällt dir ein Fehler auf, führt der Stift an der Zeile (oder die Taste E) dorthin, wo sie entsteht: eine
              Mitschriftzeile nach „Mitschreiben“, ein Tagebucheintrag ins Tagebuch, eine Aufnahme oder ein Foto nach
              „Durchsehen“, ein Sync-Signal nach „Abgleichen“. Zurück in „Ansehen“ stehst du wieder an derselben Stelle.
            </p>
            <p>
              Zitiert wird aus der Ausgabe, nicht von hier: Erst die Ausgabe hält den Stand fest, und „Stelle kopieren“
              gibt es deshalb nur im ausgegebenen Viewer.
            </p>
          </>
        }
      >
        {withEpisodes && (
          <label className="flex items-center gap-2 text-[0.9rem] text-ink-2">
            <Toggle
              checked={opts.byEpisodes}
              onChange={(v) => setOpts({ byEpisodes: v })}
              label="Nach Episoden schneiden"
            />
            Nach Episoden schneiden
          </label>
        )}
        <Button variant="primary" onClick={onNext}>
          Weiter: Ausgeben →
        </Button>
      </StepHeader>
      {error && <p className="px-6 text-bad">Die Vorschau lässt sich nicht aufbauen: {error}</p>}
      {empty && (
        <p className="px-6 text-muted" data-testid="watch-empty">
          Noch keine Quelle hat eine Uhrzeit. Sobald Aufnahmen auf der Zeitachse liegen, siehst du sie hier.
        </p>
      )}
      {/* Der Rahmen bleibt auch leer stehen, damit er bereit ist, sobald es etwas zu zeigen gibt. */}
      <iframe
        ref={frame}
        src="./watch.html"
        title="Montage und Einsatztranskript"
        allow="fullscreen; autoplay"
        className={empty || error ? "hidden" : "min-h-0 w-full flex-1 border-t border-line"}
        data-testid="watch-frame"
      />
    </div>
  );
}

/** Zeigen zwei Stände dasselbe? Dann bleibt der Rahmen, wie er ist (und die Wiedergabe läuft weiter). */
function same(a: WatchPreview, b: WatchPreview): boolean {
  return a.body === b.body && JSON.stringify([a.plan, a.tracks]) === JSON.stringify([b.plan, b.tracks]);
}
