/**
 * Schritt „Uhren abgleichen“ (Abgleichen, `sync`): Für jedes Gerät (`DeviceRow`) wird festgelegt, wie weit seine Uhr
 * von der Referenzuhr abweicht (`offsetMs`, positiv = geht vor). Drei Wege: die Abweichung von Hand eintragen,
 * Vorschläge aus dem Abgleich der Tonspuren übernehmen (Klatschen, gleiche Geräusche) oder einen Anker
 * (`AnchorRow`) setzen, auf Wunsch im Feinabgleich (`apps/desktop/src/renderer/FineAlign.tsx`).
 *
 * Eingebunden in `apps/desktop/src/renderer/app/SessionPane.tsx`; die Handler im Hauptprozess stehen in
 * `apps/desktop/src/main/ipc/sync.ts`. Hier wird keine Lage gespeichert: Aus Abweichungen und Ankern berechnet der
 * Hauptprozess die Lage aller Quellen neu und schickt sie als neue Ansicht (`SessionView`) zurück.
 */
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { AnchorRow, DeviceRow, Precision, ProposalRow, SessionView, SourceRow } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { offsetText, readOffsetInput } from "./format.ts";
import { digitsDurationText } from "../shared/duration-digits.ts";
import { positionText, usePlayback } from "./playback.tsx";
import {
  Button,
  Choice,
  cx,
  FlagMark,
  Glyph,
  Notice,
  Panel,
  Picker,
  Pill,
  PRECISION_OPTIONS,
  StepHeader,
  Tip,
} from "./ui.tsx";
import { FineAlign, guessB, useDuet, type FineAlignStart } from "./FineAlign.tsx";
import { useDraft } from "./hooks.ts";
import { isEnter } from "./keys.js";

const api = window.feldspur;

/** Betrag als m:ss ohne Vorzeichen und Bruchteile, für die beiden Enden der Abweichungsleiste. */
const mmss = (ms: number) =>
  offsetText(ms)
    .replace(/^[+−-]\s*/, "")
    .replace(/\.\d+/, "");

/**
 * Lage auf der Abweichungsleiste, −1 … 1. Bis zu einer Stunde linear; darüber gestaucht (asinh), damit
 * Sekunden-Abweichungen neben Stunden oder Tagen sichtbar bleiben.
 */
function scale(ms: number, span: number): number {
  if (span <= 3_600_000) return ms / span;
  const k = 300_000;
  return Math.asinh(ms / k) / Math.asinh(span / k);
}

/**
 * Uhren, die durch eine Handlung hier gerade an ihren Platz gerückt sind (Issue #193): bisherige Abweichung (null =
 * unbekannt) und der Anker, der sie belegt. `token` zählt jede Handlung, damit dieselbe Uhr erneut rücken kann.
 * Rückgängig läuft nicht hierüber: Dann steht der Punkt einfach wieder am alten Platz.
 */
interface Settled {
  token: number;
  moves: Map<string, { fromMs: number | null; anchorId: string | null }>;
}

/**
 * Welche Uhren sich zwischen zwei Ständen bewegt haben, und welcher neue Anker das jeweils belegt. Die Referenzuhr
 * und Uhren, deren Abweichung danach unbekannt ist, zählen nicht. Exportiert für den Test
 * `apps/desktop/test/sync-settle.test.ts`.
 */
export function settledMoves(before: SessionView, after: SessionView): Settled["moves"] {
  const known = new Set(before.anchors.map((a) => a.id));
  const fresh = after.anchors.filter((a) => !known.has(a.id));
  const deviceOf = new Map(after.rows.map((r) => [r.id, r.deviceId]));
  const moves: Settled["moves"] = new Map();
  for (const d of after.devices) {
    const was = before.devices.find((x) => x.id === d.id);
    if (!was || d.isReference || d.offsetMs === null || was.offsetMs === d.offsetMs) continue;
    const anchor = fresh.find((a) => deviceOf.get(a.a.sourceId) === d.id || deviceOf.get(a.b.sourceId) === d.id);
    moves.set(d.id, { fromMs: was.offsetMs, anchorId: anchor?.id ?? null });
  }
  return moves;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Woher die Abweichung eines Geräts stammt (`DeviceRow.offsetBasis`), als Text neben dem Eingabefeld. */
const BASIS_TEXT = {
  reference: "Referenz",
  manual: "von Hand",
  anchor: "über Anker",
  spoken: "angesagte Zeit",
  unknown: "",
} as const;
const CELL = "border-t border-line py-3";

/**
 * Der ganze Schritt: oben die Uhren mit Abweichungsleiste und Vorschlägen (`ClockRow`), darunter die Anker
 * (`ManualAnchors`), dazu der Dialog für den Feinabgleich.
 */
export function Sync({
  view,
  guard,
  onView,
  onReference,
  onOffset,
  onNext,
  onSelect,
}: {
  view: SessionView;
  /** Führt einen IPC-Aufruf aus und zeigt Fehler an, statt sie zu werfen (`apps/desktop/src/renderer/App.tsx`). */
  guard: Guard;
  /** Neue Ansicht des Einsatzes nach einer Änderung übernehmen. */
  onView: (v: SessionView) => void;
  /** Dieses Gerät zur Referenzuhr machen. */
  onReference: (id: string) => void;
  /** Abweichung eines Geräts von Hand setzen, in ms; null = wieder unbekannt. */
  onOffset: (id: string, ms: number | null) => void;
  /** Weiter zu „Durchsehen“. */
  onNext: () => void;
  /** Quelle wählen, damit sie in der Detailleiste rechts abgespielt werden kann. */
  onSelect: (id: string) => void;
}) {
  const [progress, setProgress] = useState<string | null>(null);
  /** Ergebnis der letzten Tonspur-Analyse; was davon noch offen ist, steht in `view`. */
  const [analysis, setAnalysis] = useState<{ analyzed: number; failed: number } | null>(null);
  /** Abbrechen wurde gedrückt; bis die Analyse steht, bleibt der Knopf gesperrt. */
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  /** Sammelübernahme läuft. */
  const [accepting, setAccepting] = useState(false);
  const [fine, setFine] = useState<FineAlignStart | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  /** Neuer Stand nach einer Handlung hier: Gerückte Uhren zeigen es (Bewegung, Hinterlegung, Beleg). */
  const settle = (next: SessionView) => {
    const moves = settledMoves(view, next);
    if (moves.size) setSettled((s) => ({ token: (s?.token ?? 0) + 1, moves }));
    onView(next);
  };
  const hasReference = view.devices.some((d) => d.isReference);

  if (!view.devices.length) {
    return (
      <StepHeader title="Uhren abgleichen" summary="Noch keine Geräte mit eigener Uhr. Sammle zuerst Aufnahmen ein." />
    );
  }

  // Tonspuren abgleichen: läuft im Hauptprozess und meldet den Fortschritt je Datei; das Ergebnis sind Vorschläge.
  const run = async () => {
    setProgress("Startet…");
    setCancelled(false);
    const off = api.onProgress((p) =>
      setProgress(p.fileName ? `${p.done + 1} / ${p.total} · ${p.fileName}` : "Suche Übereinstimmungen…"),
    );
    const r = await guard(() => api.analyze(view.session.id));
    off();
    setProgress(null);
    setCancelling(false);
    if (!r) return;
    onView(r.view);
    if (r.cancelled) {
      setAnalysis(null);
      setCancelled(true);
      return;
    }
    setAnalysis({ analyzed: r.analyzed, failed: r.failed.length });
  };
  const cancel = () => {
    setCancelling(true);
    void api.cancelAnalyze(view.session.id);
  };

  const sure = view.proposals.filter(isSure);
  /** Alle eindeutigen Vorschläge in einem Schritt übernehmen (unsichere bleiben zum Anhören stehen). */
  const acceptSure = async () => {
    setAccepting(true);
    const v = await guard(() =>
      api.confirmAnchors(
        view.session.id,
        sure.map((p) => p.anchorId),
      ),
    );
    setAccepting(false);
    if (v) settle(v);
  };
  const openClocks = view.devices.filter((d) => !d.isReference && d.offsetMs === null);
  const done = hasReference && !openClocks.length && !view.proposals.length;
  const notice =
    analysis &&
    [
      `${analysis.analyzed} ${analysis.analyzed === 1 ? "Tonspur" : "Tonspuren"} analysiert`,
      view.proposals.length
        ? `${view.proposals.length} ${view.proposals.length === 1 ? "Vorschlag wartet" : "Vorschläge warten"} auf dich`
        : "alle Vorschläge erledigt",
      ...(analysis.failed ? [`${analysis.failed} nicht lesbar`] : []),
    ].join(" · ");

  // Halbe Breite der Abweichungsleiste in ms: mindestens 5 Minuten, sonst die größte Abweichung (auch die der
  // Vorschläge) mit einem Viertel Rand.
  const span = Math.max(
    5 * 60_000,
    ...view.devices.map((d) => Math.abs(d.offsetMs ?? 0) * 1.25),
    ...view.proposals.map((p) => Math.abs(p.impliedOffsetMs ?? 0) * 1.25),
  );
  const ordered = view.devices.toSorted((a, b) => Number(b.isReference) - Number(a.isReference));

  return (
    <div>
      <StepHeader
        className="max-w-[1500px]"
        title="Uhren abgleichen"
        summary={
          hasReference
            ? syncSummary(view)
            : "Wähle zuerst die Referenzuhr: das Gerät, dessen Uhr am verlässlichsten lief."
        }
        help={
          <>
            Jedes Gerät hat seine eigene Uhr. Die Referenzuhr gilt als richtig, oft ist das der Audiorekorder oder ein
            Handy mit Netzzeit. Für die anderen trägst du ein, wie weit sie abweichen („Kamera geht 2:47 vor“ = +2:47),
            oder du lässt Feldspur über Klatschen und gleiche Geräusche in den Tonspuren suchen. Vorschläge gelten erst,
            wenn du sie übernimmst. Wo nichts davon hilft, setzt du unten einen Anker.
          </>
        }
      >
        <Button disabled={!!progress || !hasReference || !view.avCount} onClick={() => void run()}>
          {view.analyzedCount ? "Tonspuren erneut abgleichen" : "Tonspuren abgleichen"}
        </Button>
        {/* Erst wenn alles steht, ist „Weiter“ der Hauptknopf; vorher bleibt der Blick auf dem Offenen. */}
        <Button variant={done ? "primary" : "default"} onClick={onNext}>
          Weiter: Durchsehen →
        </Button>
      </StepHeader>
      <div className="grid max-w-[1500px] gap-4">
        <Panel>
          {progress && (
            <Notice>
              <span className="flex flex-wrap items-center gap-3">
                {progress}
                <Button size="sm" disabled={cancelling} onClick={cancel} data-testid="analyze-cancel">
                  {cancelling ? "Wird abgebrochen…" : "Abbrechen"}
                </Button>
              </span>
            </Notice>
          )}
          {cancelled && !progress && (
            <Notice>
              Abgebrochen. Schon analysierte Tonspuren bleiben gespeichert und werden beim nächsten Mal übersprungen.
            </Notice>
          )}
          {notice && !progress && !done && sure.length < 2 && <Notice>{notice}</Notice>}
          {done && (
            <p
              className="my-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-good/10 px-3 py-2 text-[0.95rem]"
              role="status"
              data-testid="sync-done"
            >
              <span>
                <b className="font-semibold text-good">Alle {view.devices.length} Uhren stimmen jetzt überein.</b> Die
                Aufnahmen liegen auf einer gemeinsamen Zeit.
              </span>
              <Button variant="link" onClick={onNext}>
                Auf der Zeitachse ansehen →
              </Button>
            </p>
          )}
          {sure.length > 1 && (
            <div className="my-2 flex flex-wrap items-center gap-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2">
              <span className="flex-1">
                {analysis && `${analysis.analyzed} ${analysis.analyzed === 1 ? "Tonspur" : "Tonspuren"} analysiert. `}
                {view.proposals.length} Vorschläge, davon {sure.length} eindeutig. Unsichere bleiben zum Anhören stehen.
              </span>
              <Button variant="primary" size="sm" disabled={accepting} onClick={() => void acceptSure()}>
                {accepting ? "Übernimmt…" : `Alle eindeutigen übernehmen (${sure.length})`}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-[minmax(140px,190px)_minmax(160px,1fr)_180px] gap-x-5">
            <span />
            <span className="flex justify-between pb-1 text-[0.85rem] whitespace-nowrap text-muted">
              <span className="font-mono">−{mmss(span)}</span>
              <span>Referenz{span > 3_600_000 ? " · gestaucht" : ""}</span>
              <span className="font-mono">+{mmss(span)}</span>
            </span>
            <span />
            {ordered.map((d) => (
              <ClockRow
                key={d.id}
                device={d}
                span={span}
                proposals={view.proposals.filter((p) => p.deviceId === d.id)}
                onReference={() => onReference(d.id)}
                onOffset={(ms) => onOffset(d.id, ms)}
                bulk={sure.length > 1}
                settled={settled}
                view={view}
                onConfirm={(id) => void guard(() => api.confirmAnchor(id)).then((v) => v && settle(v))}
                onReject={(id) => void guard(() => api.rejectAnchor(id)).then((v) => v && onView(v))}
                onFine={(p) =>
                  setFine({
                    aSourceId: p.a.sourceId,
                    aAtMs: p.a.atMs,
                    bSourceId: p.b.sourceId,
                    bAtMs: p.b.atMs,
                    replaceAnchorId: p.anchorId,
                  })
                }
              />
            ))}
          </div>
        </Panel>
        <ManualAnchors view={view} guard={guard} onView={settle} onSelect={onSelect} onFine={setFine} />
      </div>
      <FineAlign view={view} start={fine} guard={guard} onView={settle} onClose={() => setFine(null)} />
    </div>
  );
}

/** Stand in einem Satz für den Kopf des Schritts: wie viele Uhren abgeglichen sind, wie viele Vorschläge warten. */
function syncSummary(view: SessionView): string {
  const open = view.devices.filter((d) => !d.isReference && d.offsetMs === null).length;
  const parts = [`${view.devices.length - open} von ${view.devices.length} Uhren abgeglichen`];
  if (view.proposals.length)
    parts.push(`${view.proposals.length} ${view.proposals.length === 1 ? "Vorschlag" : "Vorschläge"} zu prüfen`);
  return `${parts.join(", ")}.`;
}

/**
 * Ein Gerät: Name, Punkt auf der Abweichungsleiste (gestrichelt: wohin ein Vorschlag die Uhr rücken würde), das
 * Eingabefeld oder „Referenzuhr“, darunter der Beleg einer gerade gerückten Uhr und die offenen Vorschläge.
 */
function ClockRow({
  device,
  view,
  settled,
  span,
  proposals,
  bulk,
  onReference,
  onOffset,
  onConfirm,
  onReject,
  onFine,
}: {
  device: DeviceRow;
  view: SessionView;
  settled: Settled | null;
  /** Halbe Breite der Leiste in ms (siehe `scale`). */
  span: number;
  /** Offene Vorschläge für dieses Gerät. */
  proposals: ProposalRow[];
  /** Sammelaktion sichtbar: dann ist sie der Hauptknopf, nicht jedes einzelne „Übernehmen“. */
  bulk: boolean;
  onReference: () => void;
  onOffset: (ms: number | null) => void;
  onConfirm: (anchorId: string) => void;
  onReject: (anchorId: string) => void;
  onFine: (p: ProposalRow) => void;
}) {
  const pos = (ms: number) => `${50 + scale(ms, span) * 50}%`;
  const dot = "absolute top-1/2 -mt-[7px] -ml-[7px] size-3.5 rounded-full";
  // Abweichung von Hand: die bisherige merken, bis die neue da ist; dann rückt der Punkt wie beim Übernehmen.
  const typedFrom = useRef<{ fromMs: number | null } | null>(null);
  const move = settled?.moves.get(device.id) ?? null;
  const [typed, setTyped] = useState<{ token: number; fromMs: number | null } | null>(null);
  const [lastOffset, setLastOffset] = useState(device.offsetMs);
  if (lastOffset !== device.offsetMs) {
    setLastOffset(device.offsetMs);
    if (typedFrom.current && device.offsetMs !== null)
      setTyped({ token: (typed?.token ?? 0) + 1, fromMs: typedFrom.current.fromMs });
    typedFrom.current = null;
  }
  // Ein Rücken durch einen Anker (`settled`) geht dem durch eine Eingabe von Hand vor.
  const motion = move
    ? { key: `a${settled!.token}`, fromMs: move.fromMs }
    : typed
      ? { key: `h${typed.token}`, fromMs: typed.fromMs }
      : null;
  const dotRef = useRef<HTMLSpanElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!motion || device.offsetMs === null) return;
    setFlash(motion.key);
    // Die Uhr ist schon übernommen; die Bewegung zeigt es nur und hält nichts auf.
    if (!reducedMotion())
      dotRef.current?.animate(
        [{ left: motion.fromMs === null ? "50%" : pos(motion.fromMs) }, { left: pos(device.offsetMs) }],
        {
          duration: 300,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
    const t = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(t);
    // Nur bei einer neuen Handlung, nicht bei jeder Darstellung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion?.key]);
  const lit = !!flash && flash === motion?.key;
  const cell = (extra: string) => cx(CELL, extra, "settle-cell", lit && "settle-lit");
  const anchor = move?.anchorId ? view.anchors.find((a) => a.id === move.anchorId) : undefined;
  return (
    <div className="contents" data-testid="clock" data-device={device.label} data-settled={lit || undefined}>
      <div className={cell("flex items-center gap-2.5 rounded-l-lg pl-2")}>
        <Glyph kind={device.kind} />
        <div>
          <b className="font-semibold">{device.label}</b>
          <div className="text-[0.85rem] text-muted">
            {device.sourceCount} {device.sourceCount === 1 ? "Datei" : "Dateien"}
            {device.personName && ` · ${device.personName}`}
          </div>
        </div>
      </div>
      <div className={cell("settle-bridge relative")} aria-hidden>
        <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-line" />
        <span className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
        {proposals.map(
          (p) =>
            p.impliedOffsetMs !== null && (
              <span
                key={p.anchorId}
                className={cx(dot, "border-2 border-dashed border-warn")}
                style={{ left: pos(p.impliedOffsetMs) }}
              />
            ),
        )}
        {device.offsetMs !== null && (
          <Tip content={offsetText(device.offsetMs)}>
            <span
              ref={dotRef}
              className={cx(dot, "shadow-[0_0_0_3px_var(--panel)]", device.isReference ? "bg-ink-2" : "bg-accent")}
              style={{ left: pos(device.offsetMs) }}
            />
          </Tip>
        )}
        {device.offsetMs === null && (
          <span className="absolute top-1/2 left-1/2 -translate-1/2 rounded-full border border-dashed border-warn bg-panel px-2 text-[0.8rem] whitespace-nowrap text-warn">
            Abweichung unbekannt
          </span>
        )}
      </div>
      <div
        className={cell("flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-r-lg pr-2")}
        data-testid="clock-value"
      >
        {device.isReference ? (
          <Pill tone="accent">
            <FlagMark size={10} className="mr-1 inline align-[-1px]" />
            Referenzuhr
          </Pill>
        ) : (
          <>
            <OffsetInput
              device={device}
              onOffset={(ms) => {
                // Nur eine echte Änderung lässt den Punkt rücken (Verlassen des Felds bestätigt sonst noch einmal).
                typedFrom.current = ms === device.offsetMs ? null : { fromMs: device.offsetMs };
                onOffset(ms);
              }}
            />
            <Button variant="link" className="basis-full text-left text-[0.85rem]" onClick={onReference}>
              als Referenz
            </Button>
          </>
        )}
      </div>
      {anchor && <AnchorProof anchor={anchor} rows={view.rows} />}
      {proposals.map((p) => (
        <Proposal
          key={p.anchorId}
          p={p}
          bulk={bulk}
          onConfirm={() => onConfirm(p.anchorId)}
          onReject={() => onReject(p.anchorId)}
          onFine={() => onFine(p)}
        />
      ))}
    </div>
  );
}

/** Das Feld zeigt ganze Sekunden; eine gemessene Abweichung (Anker) hat Bruchteile, die beim Abgleich zählen. */
const subSecond = (ms: number | null) => ms !== null && Math.abs(ms) < 60_000 && ms % 1000 !== 0;
/** Abweichung unter einer Minute mit Hundertstelsekunden, z. B. „+0,35 s“. */
const preciseOffset = (ms: number) =>
  `${ms < 0 ? "−" : "+"}${(Math.abs(ms) / 1000).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;

/**
 * Beleg unter einer gerade gerückten Uhr: welcher Anker sie trägt, und beide Stellen zum Anhören, ohne den
 * Feinabgleich zu öffnen. Wie in der Ankerliste geschrieben; verschwindet, sobald es den Anker nicht mehr gibt.
 */
function AnchorProof({ anchor, rows }: { anchor: AnchorRow; rows: SourceRow[] }) {
  const a = rows.find((r) => r.id === anchor.a.sourceId);
  const b = rows.find((r) => r.id === anchor.b.sourceId);
  return (
    <div
      className="col-span-full mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 pl-2 text-[0.88rem]"
      data-testid="anchor-proof"
    >
      <Pill>
        <span aria-hidden className="text-good">
          ✓
        </span>{" "}
        {ANCHOR_KIND[anchor.kind]}
      </Pill>
      <span className="text-muted">
        {anchor.description}
        {anchor.note && ` · ${anchor.note}`}
      </span>
      <span className="flex-1" />
      {a && b && <ListenBoth a={a} b={b} anchor={anchor} />}
    </div>
  );
}

/** Beide Stellen eines Ankers gleichzeitig, links und rechts: Liegen sie richtig, verschmelzen sie zu einem Klang. */
function ListenBoth({ a, b, anchor }: { a: SourceRow; b: SourceRow; anchor: AnchorRow }) {
  const player = useDuet(a, b, "both");
  return (
    <>
      <Button
        variant="link"
        className="text-[0.88rem]"
        onClick={() => player.toggle(anchor.a.atMs, anchor.b.atMs - anchor.a.atMs)}
        title="Beide Aufnahmen ab 1,5 s vor der Stelle, die erste links, die zweite rechts"
        data-testid="anchor-listen"
      >
        {player.playing ? "■ Anhalten" : "▶ Beide anhören"}
      </Button>
      {player.element}
    </>
  );
}

/**
 * Eingabefeld für die Abweichung eines Geräts („+2:47“). Gesperrt, solange die Abweichung aus einem Anker oder einer
 * angesagten Zeit stammt. Gespeichert wird bei Enter oder beim Verlassen des Felds; Esc verwirft die Eingabe.
 */
function OffsetInput({ device, onOffset }: { device: DeviceRow; onOffset: (ms: number | null) => void }) {
  const show = (ms: number | null) => (ms === null ? "" : offsetText(ms));
  const [text, setText] = useDraft(show(device.offsetMs));
  /** Zuletzt bestätigte Eingabe war nicht lesbar: dann bleibt der alte Abgleich und das Feld zeigt den Fehler. */
  const [invalid, setInvalid] = useState(false);
  const hintId = useId();
  const commit = () => {
    const ms = readOffsetInput(text);
    if (ms === "invalid") return setInvalid(true);
    setInvalid(false);
    if (ms !== device.offsetMs) onOffset(ms);
  };
  const revert = () => {
    setText(show(device.offsetMs));
    setInvalid(false);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        className={cx("w-[5.5rem] text-right font-mono disabled:bg-sunken", invalid && "border-bad text-bad")}
        value={text}
        placeholder="z. B. +2:47"
        title="Wie weit diese Uhr von der Referenz abweicht: +2:47 = geht 2 Minuten 47 vor, −0:30 = geht 30 Sekunden nach. Ohne Doppelpunkt geht auch: +247, −30"
        aria-label={`Abweichung ${device.label}`}
        aria-invalid={invalid}
        aria-describedby={invalid ? hintId : undefined}
        disabled={device.offsetBasis === "anchor" || device.offsetBasis === "spoken"}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (isEnter(e)) commit();
          else if (e.key === "Escape" && (invalid || text !== show(device.offsetMs))) {
            e.preventDefault();
            e.stopPropagation();
            revert();
          }
        }}
      />
      {invalid ? (
        <span id={hintId} className="text-[0.85rem] text-bad">
          Nicht lesbar. Beispiel: +2:47 (oder +247) oder −0:30
        </span>
      ) : (
        <span className={cx("text-[0.85rem]", device.offsetMs === null ? "text-warn" : "text-muted")}>
          {device.offsetMs === null ? "ohne Abgleich" : BASIS_TEXT[device.offsetBasis]}
          {subSecond(device.offsetMs) && ` (${preciseOffset(device.offsetMs!)})`}
        </span>
      )}
    </span>
  );
}

/**
 * Ein Vorschlag aus dem Abgleich der Tonspuren: ein Anker, der erst gilt, wenn er übernommen wird
 * (`ProposalRow.anchorId`). „Fein justieren…“ öffnet den Feinabgleich und ersetzt den Vorschlag durch dessen Ergebnis.
 */
function Proposal({
  p,
  bulk,
  onConfirm,
  onReject,
  onFine,
}: {
  p: ProposalRow;
  bulk: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onFine: () => void;
}) {
  const sure = isSure(p);
  return (
    <div
      data-testid="proposal"
      className="col-span-full mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2"
    >
      <span className="text-[0.78rem] font-semibold text-warn">Vorschlag</span>
      <div className="flex-1">
        <div>
          Uhr geht <b className="font-mono">{p.impliedOffset ?? "?"}</b>, gefunden in <b>{p.sourceLabel}</b>{" "}
          <span className="font-mono text-[0.85rem] text-muted">{p.fileName}</span>
        </div>
        <div className="text-[0.85rem] text-muted">
          {p.description} · {p.note} ·{" "}
          <span className={sure ? "text-good" : "text-warn"}>{sure ? "eindeutig" : "unsicher, bitte anhören"}</span>
        </div>
      </div>
      <Button variant={bulk ? "default" : "primary"} size="sm" onClick={onConfirm}>
        Übernehmen
      </Button>
      <Button size="sm" onClick={onFine} title="Waveforms übereinander ansehen und genau ausrichten">
        Fein justieren…
      </Button>
      <Button size="sm" onClick={onReject}>
        Verwerfen
      </Button>
    </div>
  );
}

/** „Eindeutig“ ab einer Konfidenz von 0,5: Nur solche Vorschläge nimmt die Sammelübernahme mit. */
const isSure = (p: ProposalRow) => (p.confidence ?? 0) >= 0.5;

/** "1:20.5" → ms; leer oder unlesbar → null. */
function safePos(text: string): number | null {
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(text.trim());
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map((x) => Number(x!.replace(",", ".")));
  return Math.round(parts.reduce((acc, p) => acc * 60 + p, 0) * 1000);
}

/** Wie ein Anker entstanden ist (`AnchorRow.kind`), als Beschriftung. */
const ANCHOR_KIND = { clap: "Klatschen", "audio-correlation": "Tonspur", manual: "von Hand" } as const;

/**
 * Gleiche Stelle in zwei Aufnahmen von Hand verbinden, und gesetzte Anker verwalten. Die Stellen werden als Text
 * („m:ss“) an den Hauptprozess gegeben, der sie liest; nur für den Feinabgleich rechnet `safePos` sie hier um.
 */
function ManualAnchors({
  view,
  guard,
  onView,
  onSelect,
  onFine,
}: {
  view: SessionView;
  guard: Guard;
  onView: (v: SessionView) => void;
  onSelect: (id: string) => void;
  onFine: (start: FineAlignStart) => void;
}) {
  const { position } = usePlayback();
  // Tagebuchseiten haben keine Stelle, die sich verbinden ließe.
  const sources = view.rows
    .filter((r) => r.kind !== "diary")
    .map((r) => ({ value: r.id, label: `${r.label} · ${r.fileName}` }));
  const [a, setA] = useState("");
  const [aAt, setAAt] = useState("");
  const [b, setB] = useState("");
  const [bAt, setBAt] = useState("");
  const [precision, setPrecision] = useState<Precision>("exact");
  const [note, setNote] = useState("");
  // Das Formular steht erst auf Wunsch da: Anker sind der Ausweg, nicht der Normalfall.
  const [showForm, setFormOpen] = useState(false);

  const rowOf = (id: string) => view.rows.find((r) => r.id === id);
  const isAv = (id: string) => ["audio", "video"].includes(rowOf(id)?.kind ?? "");

  const submit = async () => {
    const v = await guard(() => api.addAnchor({ aSourceId: a, aAt, bSourceId: b, bAt, precision, note }));
    if (!v) return;
    onView(v);
    setA("");
    setB("");
    setAAt("");
    setBAt("");
    setNote("");
    setFormOpen(false);
  };
  const side = (label: string, value: string, set: (v: string) => void, at: string, setAt: (v: string) => void) => (
    <fieldset className="grid min-w-0 content-start gap-1.5">
      <legend className="sr-only">{label}</legend>
      <span className="text-[0.85rem] font-medium text-ink-2">{label}</span>
      <Picker
        label={label}
        placeholder="Aufnahme wählen…"
        value={value}
        onChange={(id) => {
          set(id);
          onSelect(id);
        }}
        options={sources}
        className="w-full"
      />
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[0.85rem] text-muted">Stelle</span>
        <input
          className="w-24 font-mono"
          placeholder="m:ss"
          title="Stelle in der Aufnahme, auch ohne Doppelpunkt: 320 für 3:20, 10320 für 1:03:20"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          onBlur={() => setAt(digitsDurationText(at))}
          aria-label={`${label}, Stelle`}
        />
        {value && position?.sourceId === value && (
          <Button
            variant="link"
            type="button"
            className="text-[0.85rem]"
            onClick={() => setAt(positionText(position.atMs))}
          >
            ↳ aus Wiedergabe ({positionText(position.atMs)})
          </Button>
        )}
      </span>
    </fieldset>
  );

  return (
    <Panel>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="font-semibold">Anker</h3>
        {!showForm && (
          <Button variant="link" aria-expanded={false} onClick={() => setFormOpen(true)}>
            + Neuer Anker
          </Button>
        )}
      </div>
      <p className="mt-0.5 mb-3 max-w-[72ch] text-[0.9rem] text-muted">
        Derselbe Moment in zwei Aufnahmen, etwa eine knallende Tür. Liegt eine davon schon sicher, gleicht das die Uhr
        des anderen Geräts ab.
        {showForm && " Gewählte Aufnahmen spielen rechts ab; die gehörte Stelle übernimmst du mit „aus Wiedergabe“."}
        {!view.anchors.length && !showForm && " Nur nötig, wo Tonspuren und Abweichung nicht weiterhelfen."}
      </p>
      {view.anchors.length > 0 && (
        <ul className="mb-4 grid gap-1.5" data-testid="anchor-list">
          {view.anchors.map((x) => (
            <li key={x.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-1.5">
              <Pill>{ANCHOR_KIND[x.kind]}</Pill>
              <span className="font-mono text-[0.9rem]">{x.description}</span>
              {x.note && <span className="text-[0.85rem] text-muted">{x.note}</span>}
              {x.conflictMs !== null && <Pill tone="warn">widerspricht um {offsetText(x.conflictMs)}</Pill>}
              <span className="flex-1" />
              <Button
                variant="link"
                className="text-[0.85rem]"
                onClick={() =>
                  onFine({
                    aSourceId: x.a.sourceId,
                    aAtMs: x.a.atMs,
                    bSourceId: x.b.sourceId,
                    bAtMs: x.b.atMs,
                    replaceAnchorId: x.id,
                    note: x.note,
                  })
                }
              >
                fein justieren
              </Button>
              <Button
                variant="link"
                className="text-[0.85rem]"
                onClick={() => void guard(() => api.rejectAnchor(x.id)).then((v) => v && onView(v))}
              >
                löschen
              </Button>
            </li>
          ))}
        </ul>
      )}
      {showForm && (
        <form
          className="grid gap-2"
          data-testid="anchor-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            {side("Erste Aufnahme", a, setA, aAt, setAAt)}
            <span className="text-lg font-semibold text-muted" title="derselbe Moment">
              =
            </span>
            {side("Zweite Aufnahme", b, setB, bAt, setBAt)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Choice
              label="Genauigkeit des Ankers"
              value={precision}
              onChange={setPrecision}
              options={PRECISION_OPTIONS}
            />
            <input
              className="min-w-48 flex-1"
              placeholder="Notiz, z. B. „Tür knallt“"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Notiz zum Anker"
            />
            <Button
              size="sm"
              type="button"
              disabled={!a || !b || a === b || !isAv(a) || !isAv(b)}
              title="Waveforms beider Aufnahmen übereinander legen und genau ausrichten"
              onClick={() => {
                // Ohne eingetragene Stelle: bei der ersten Aufnahme die Wiedergabestelle (sonst der Anfang), bei der
                // zweiten eine Schätzung (`guessB`).
                const ra = rowOf(a);
                const aMs = safePos(aAt) ?? (position?.sourceId === a ? position.atMs : 0);
                const bMs = safePos(bAt) ?? guessB(ra, rowOf(b), aMs);
                onFine({ aSourceId: a, aAtMs: aMs, bSourceId: b, bAtMs: bMs, note });
              }}
              data-testid="fine-open"
            >
              Fein abgleichen…
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={!a || !b || a === b}>
              Anker setzen
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={() => setFormOpen(false)}>
              Abbrechen
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
