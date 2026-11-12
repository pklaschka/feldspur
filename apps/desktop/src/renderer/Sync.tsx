import { useEffect, useState } from "react";
import type { DeviceRow, Precision, ProposalRow, SessionView } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { offsetText, parseOffset } from "./format.ts";
import { positionText, usePlayback } from "./playback.tsx";
import { Button, Choice, cx, Glyph, Notice, Panel, Picker, Pill, PRECISION_OPTIONS, StepHeader, Tip } from "./ui.tsx";

const api = window.feldspur;

const mmss = (ms: number) =>
  offsetText(ms)
    .replace(/^[+−-]\s*/, "")
    .replace(/\.\d+/, "");

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
  const [notice, setNotice] = useState<string | null>(null);
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
    const n = r.view.proposals.length;
    setNotice(
      [
        `${r.analyzed} ${r.analyzed === 1 ? "Tonspur" : "Tonspuren"} analysiert`,
        n ? `${n} ${n === 1 ? "Vorschlag" : "Vorschläge"}` : "keine neuen Vorschläge",
        ...(r.failed.length ? [`${r.failed.length} nicht lesbar`] : []),
      ].join(" · "),
    );
  };

  const span = Math.max(
    5 * 60_000,
    ...view.devices.map((d) => Math.abs(d.offsetMs ?? 0) * 1.25),
    ...view.proposals.map((p) => Math.abs(p.impliedOffsetMs ?? 0) * 1.25),
  );
  const ordered = [...view.devices].sort((a, b) => Number(b.isReference) - Number(a.isReference));

  return (
    <div>
      <StepHeader
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
        <Button variant="primary" onClick={onNext}>
          Weiter: Durchsehen →
        </Button>
      </StepHeader>
      <div className="grid gap-4">
        <Panel>
          {progress && <Notice>{progress}</Notice>}
          {notice && !progress && <Notice>{notice}</Notice>}
          <div className="grid grid-cols-[minmax(140px,190px)_minmax(160px,1fr)_180px] gap-x-5">
            <span />
            <span className="flex justify-between pb-1 text-[0.8rem] whitespace-nowrap text-muted">
              <span className="font-mono">−{mmss(span)}</span>
              <span>Referenz</span>
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
                onConfirm={(id) => void guard(() => api.confirmAnchor(id)).then((v) => v && onView(v))}
                onReject={(id) => void guard(() => api.rejectAnchor(id)).then((v) => v && onView(v))}
              />
            ))}
          </div>
        </Panel>
        <ManualAnchors view={view} guard={guard} onView={onView} onSelect={onSelect} />
      </div>
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
  onReference,
  onOffset,
  onConfirm,
  onReject,
}: {
  device: DeviceRow;
  span: number;
  proposals: ProposalRow[];
  onReference: () => void;
  onOffset: (ms: number | null) => void;
  onConfirm: (anchorId: string) => void;
  onReject: (anchorId: string) => void;
}) {
  const pos = (ms: number) => `${50 + (ms / span) * 50}%`;
  const dot = "absolute top-1/2 -mt-[7px] -ml-[7px] size-3.5 rounded-full";
  return (
    <div className="contents" data-testid="clock" data-device={device.label}>
      <div className={cx(CELL, "flex items-center gap-2.5")}>
        <Glyph kind={device.kind} />
        <div>
          <b className="font-semibold">{device.label}</b>
          <div className="text-[0.8rem] text-muted">
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
          <span className="absolute top-1/2 left-1/2 -translate-1/2 rounded-full border border-dashed border-warn bg-panel px-2 text-[0.75rem] whitespace-nowrap text-warn">
            Abweichung unbekannt
          </span>
        )}
      </div>
      <div className={cx(CELL, "flex flex-wrap items-center gap-x-2.5 gap-y-1")} data-testid="clock-value">
        {device.isReference ? (
          <Pill tone="accent">Referenzuhr</Pill>
        ) : (
          <>
            <OffsetInput device={device} onOffset={onOffset} />
            <Button variant="link" className="basis-full text-left text-[0.8rem]" onClick={onReference}>
              als Referenz
            </Button>
          </>
        )}
      </div>
      {proposals.map((p) => (
        <Proposal
          key={p.anchorId}
          p={p}
          onConfirm={() => onConfirm(p.anchorId)}
          onReject={() => onReject(p.anchorId)}
        />
      ))}
    </div>
  );
}

function OffsetInput({ device, onOffset }: { device: DeviceRow; onOffset: (ms: number | null) => void }) {
  const show = (ms: number | null) => (ms === null ? "" : offsetText(ms));
  const [text, setText] = useState(show(device.offsetMs));
  useEffect(() => setText(show(device.offsetMs)), [device.offsetMs]);
  const commit = () => {
    const ms = parseOffset(text);
    if (ms !== device.offsetMs) onOffset(ms);
  };
  return (
    <span className="inline-flex items-center gap-2">
      <input
        className="w-[5.5rem] text-right font-mono disabled:bg-sunken"
        value={text}
        placeholder="±m:ss"
        aria-label={`Abweichung ${device.label}`}
        disabled={device.offsetBasis === "anchor" || device.offsetBasis === "spoken"}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className={cx("text-[0.8rem]", device.offsetMs === null ? "text-warn" : "text-muted")}>
        {device.offsetMs === null ? "offen" : BASIS_TEXT[device.offsetBasis]}
      </span>
    </span>
  );
}

function Proposal({ p, onConfirm, onReject }: { p: ProposalRow; onConfirm: () => void; onReject: () => void }) {
  const sure = (p.confidence ?? 0) >= 0.5;
  return (
    <div
      data-testid="proposal"
      className="col-span-full mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2"
    >
      <span className="text-[0.7rem] font-semibold tracking-[0.05em] text-warn uppercase">Vorschlag</span>
      <div className="flex-1">
        <div>
          Uhr geht <b className="font-mono">{p.impliedOffset ?? "?"}</b>, gefunden in <b>{p.sourceLabel}</b>{" "}
          <span className="font-mono text-[0.8rem] text-muted">{p.fileName}</span>
        </div>
        <div className="text-[0.8rem] text-muted">
          {p.description} · {p.note} ·{" "}
          <span className={sure ? "text-good" : "text-warn"}>{sure ? "eindeutig" : "unsicher, bitte anhören"}</span>
        </div>
      </div>
      <Button variant="primary" size="sm" onClick={onConfirm}>
        Übernehmen
      </Button>
      <Button size="sm" onClick={onReject}>
        Verwerfen
      </Button>
    </div>
  );
}

const ANCHOR_KIND = { clap: "Klatschen", "audio-correlation": "Tonspur", manual: "von Hand" } as const;

/** Gleiche Stelle in zwei Aufnahmen von Hand verbinden, und gesetzte Anker verwalten. */
function ManualAnchors({
  view,
  guard,
  onView,
  onSelect,
}: {
  view: SessionView;
  guard: Guard;
  onView: (v: SessionView) => void;
  onSelect: (id: string) => void;
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

  const submit = async () => {
    const v = await guard(() => api.addAnchor({ aSourceId: a, aAt, bSourceId: b, bAt, precision, note }));
    if (!v) return;
    onView(v);
    setA("");
    setB("");
    setAAt("");
    setBAt("");
    setNote("");
  };
  const side = (label: string, value: string, set: (v: string) => void, at: string, setAt: (v: string) => void) => (
    <fieldset className="grid min-w-0 content-start gap-1.5 rounded-lg border border-line bg-panel-2 p-2.5">
      <legend className="sr-only">{label}</legend>
      <span className="text-[0.8rem] font-medium text-ink-2">{label}</span>
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
        <span className="text-[0.8rem] text-muted">Stelle</span>
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
            className="text-[0.8rem]"
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
      <h3 className="font-semibold">Anker</h3>
      <p className="mt-0.5 mb-3 max-w-[72ch] text-[0.85rem] text-muted">
        Derselbe Moment in zwei Aufnahmen, etwa eine knallende Tür. Liegt eine davon schon sicher, gleicht das die Uhr
        des anderen Geräts ab. Gewählte Aufnahmen spielen rechts ab; die gehörte Stelle übernimmst du mit „aus
        Wiedergabe“.
      </p>
      {view.anchors.length > 0 && (
        <ul className="mb-4 grid gap-1.5" data-testid="anchor-list">
          {view.anchors.map((x) => (
            <li key={x.id} className="flex items-center gap-3 rounded-[7px] border border-line px-3 py-1.5">
              <Pill>{ANCHOR_KIND[x.kind]}</Pill>
              <span className="font-mono text-[0.85rem]">{x.description}</span>
              {x.note && <span className="text-[0.8rem] text-muted">{x.note}</span>}
              {x.conflictMs !== null && <Pill tone="warn">widerspricht um {offsetText(x.conflictMs)}</Pill>}
              <span className="flex-1" />
              <Button
                variant="link"
                className="text-[0.8rem]"
                onClick={() => void guard(() => api.rejectAnchor(x.id)).then((v) => v && onView(v))}
              >
                löschen
              </Button>
            </li>
          ))}
        </ul>
      )}
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
          <Button variant="primary" size="sm" type="submit" disabled={!a || !b || a === b}>
            Anker setzen
          </Button>
        </div>
      </form>
    </Panel>
  );
}
