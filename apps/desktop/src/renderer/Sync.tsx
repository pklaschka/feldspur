import { useId, useState } from "react";
import type { DeviceRow, Precision, ProposalRow, SessionView } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { offsetText, readOffsetInput } from "./format.ts";
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
import { FineAlign, guessB, type FineAlignStart } from "./FineAlign.tsx";
import { useDraft } from "./hooks.ts";
import { isEnter } from "./keys.js";

const api = window.feldspur;

const mmss = (ms: number) =>
  offsetText(ms)
    .replace(/^[+−-]\s*/, "")
    .replace(/\.\d+/, "");

/**
 * Lage auf der Abweichungsleiste, −1 … 1. Bis zu einer Stunde linear; darüber gestaucht (asinh), damit
 * Sekunden-Abweichungen neben Stunden oder Tagen sichtbar bleiben.
 */
export function scale(ms: number, span: number): number {
  if (span <= 3_600_000) return ms / span;
  const k = 300_000;
  return Math.asinh(ms / k) / Math.asinh(span / k);
}

const BASIS_TEXT = {
  reference: "Referenz",
  manual: "von Hand",
  anchor: "über Anker",
  spoken: "angesagte Zeit",
  unknown: "",
} as const;
const CELL = "border-t border-line py-3";

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
  guard: Guard;
  onView: (v: SessionView) => void;
  onReference: (id: string) => void;
  onOffset: (id: string, ms: number | null) => void;
  onNext: () => void;
  onSelect: (id: string) => void;
}) {
  const [progress, setProgress] = useState<string | null>(null);
  /** Ergebnis der letzten Tonspur-Analyse; was davon noch offen ist, steht in `view`. */
  const [analysis, setAnalysis] = useState<{ analyzed: number; failed: number } | null>(null);
  /** Sammelübernahme läuft. */
  const [accepting, setAccepting] = useState(false);
  const [fine, setFine] = useState<FineAlignStart | null>(null);
  const hasReference = view.devices.some((d) => d.isReference);

  if (!view.devices.length) {
    return (
      <StepHeader title="Uhren abgleichen" summary="Noch keine Geräte mit eigener Uhr. Sammle zuerst Aufnahmen ein." />
    );
  }

  const run = async () => {
    setProgress("Starte…");
    const off = api.onProgress((p) =>
      setProgress(p.fileName ? `${p.done + 1} / ${p.total} · ${p.fileName}` : "Suche Übereinstimmungen…"),
    );
    const r = await guard(() => api.analyze(view.session.id));
    off();
    setProgress(null);
    if (!r) return;
    onView(r.view);
    setAnalysis({ analyzed: r.analyzed, failed: r.failed.length });
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
    if (v) onView(v);
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
          {progress && <Notice>{progress}</Notice>}
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
                {accepting ? "Übernehme…" : `Alle eindeutigen übernehmen (${sure.length})`}
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
                onConfirm={(id) => void guard(() => api.confirmAnchor(id)).then((v) => v && onView(v))}
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
        <ManualAnchors view={view} guard={guard} onView={onView} onSelect={onSelect} onFine={setFine} />
      </div>
      <FineAlign view={view} start={fine} guard={guard} onView={onView} onClose={() => setFine(null)} />
    </div>
  );
}

function syncSummary(view: SessionView): string {
  const open = view.devices.filter((d) => !d.isReference && d.offsetMs === null).length;
  const parts = [`${view.devices.length - open} von ${view.devices.length} Uhren abgeglichen`];
  if (view.proposals.length)
    parts.push(`${view.proposals.length} ${view.proposals.length === 1 ? "Vorschlag" : "Vorschläge"} zu prüfen`);
  return `${parts.join(", ")}.`;
}

function ClockRow({
  device,
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
  span: number;
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
  return (
    <div className="contents" data-testid="clock" data-device={device.label}>
      <div className={cx(CELL, "flex items-center gap-2.5")}>
        <Glyph kind={device.kind} />
        <div>
          <b className="font-semibold">{device.label}</b>
          <div className="text-[0.85rem] text-muted">
            {device.sourceCount} {device.sourceCount === 1 ? "Datei" : "Dateien"}
            {device.personName && ` · ${device.personName}`}
          </div>
        </div>
      </div>
      <div className={cx(CELL, "relative")} aria-hidden>
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
      <div className={cx(CELL, "flex flex-wrap items-center gap-x-2.5 gap-y-1")} data-testid="clock-value">
        {device.isReference ? (
          <Pill tone="accent">
            <FlagMark size={10} className="mr-1 inline align-[-1px]" />
            Referenzuhr
          </Pill>
        ) : (
          <>
            <OffsetInput device={device} onOffset={onOffset} />
            <Button variant="link" className="basis-full text-left text-[0.85rem]" onClick={onReference}>
              als Referenz
            </Button>
          </>
        )}
      </div>
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
        title="Wie weit diese Uhr von der Referenz abweicht: +2:47 = geht 2 Minuten 47 vor, −0:30 = geht 30 Sekunden nach"
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
          Nicht lesbar. Beispiel: +2:47 oder −0:30
        </span>
      ) : (
        <span className={cx("text-[0.85rem]", device.offsetMs === null ? "text-warn" : "text-muted")}>
          {device.offsetMs === null ? "ohne Abgleich" : BASIS_TEXT[device.offsetBasis]}
        </span>
      )}
    </span>
  );
}

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

const isSure = (p: ProposalRow) => (p.confidence ?? 0) >= 0.5;

/** "1:20.5" → ms; leer oder unlesbar → null. */
function safePos(text: string): number | null {
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(text.trim());
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map((x) => Number(x!.replace(",", ".")));
  return Math.round(parts.reduce((acc, p) => acc * 60 + p, 0) * 1000);
}

const ANCHOR_KIND = { clap: "Klatschen", "audio-correlation": "Tonspur", manual: "von Hand" } as const;

/** Gleiche Stelle in zwei Aufnahmen von Hand verbinden, und gesetzte Anker verwalten. */
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
          value={at}
          onChange={(e) => setAt(e.target.value)}
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
