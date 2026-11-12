import { useEffect, useState } from "react";
import type { DeviceRow, Precision, ProposalRow, SessionView } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { offsetText, parseOffset } from "./format.ts";
import { Button, Choice, cx, Glyph, Notice, Panel, Picker, Pill, PRECISION_OPTIONS, Tip } from "./ui.tsx";

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
}: {
  view: SessionView;
  guard: Guard;
  onView: (v: SessionView) => void;
  onReference: (id: string) => void;
  onOffset: (id: string, ms: number | null) => void;
  onNext: () => void;
}) {
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hasReference = view.devices.some((d) => d.isReference);

  if (!view.devices.length) {
    return (
      <Panel className="max-w-[640px]">
        <h2 className="text-base font-semibold">Uhren abgleichen</h2>
        <p className="mt-2 text-muted">Noch keine Geräte mit eigener Uhr. Sammle zuerst Aufnahmen ein.</p>
      </Panel>
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
    <div className="grid gap-4">
      <Panel>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">Uhren abgleichen</h2>
          <span className="flex-1" />
          <Button disabled={!!progress || !hasReference || !view.avCount} onClick={() => void run()}>
            {view.analyzedCount ? "Tonspuren erneut abgleichen" : "Tonspuren abgleichen"}
          </Button>
          <Button variant="primary" onClick={onNext}>
            Weiter: Durchsehen →
          </Button>
        </div>
        <p className="mb-4 max-w-[70ch] text-[0.8rem] text-muted">
          {hasReference
            ? "Jedes Gerät hat seine eigene Uhr. Die Referenzuhr gilt als richtig; für die anderen trägst du ein, wie weit sie abweichen („Kamera geht 2:47 vor“ = +2:47), oder lässt Feldspur über Klatschen und gleiche Geräusche in den Tonspuren suchen. Vorschläge werden erst übernommen, wenn du sie bestätigst."
            : "Wähle zuerst die Referenzuhr: das Gerät, dessen Uhr am verlässlichsten lief (oft der Audiorekorder oder das Handy mit Netzzeit)."}
        </p>
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
      <ManualAnchors view={view} guard={guard} onView={onView} />
    </div>
  );
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
          <span className="absolute inset-x-0 bottom-0.5 text-center text-[0.75rem] text-warn">
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
      className="col-span-full mb-3 flex items-center gap-3 rounded-lg bg-warn-soft px-3 py-2"
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
function ManualAnchors({ view, guard, onView }: { view: SessionView; guard: Guard; onView: (v: SessionView) => void }) {
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
    setAAt("");
    setBAt("");
    setNote("");
  };
  const side = (label: string, value: string, set: (v: string) => void, at: string, setAt: (v: string) => void) => (
    <div className="flex flex-wrap items-center gap-2">
      <Picker
        label={label}
        placeholder="Aufnahme wählen…"
        value={value}
        onChange={set}
        options={sources}
        className="w-64"
      />
      <span className="text-[0.8rem] text-muted">bei</span>
      <input
        className="w-24 font-mono"
        placeholder="m:ss"
        value={at}
        onChange={(e) => setAt(e.target.value)}
        aria-label={`${label}, Stelle`}
      />
    </div>
  );

  return (
    <Panel>
      <h2 className="text-base font-semibold">Anker</h2>
      <p className="mt-1 mb-3 max-w-[70ch] text-[0.8rem] text-muted">
        Ein Anker sagt: Diese Stelle in der einen Aufnahme ist derselbe Moment wie diese Stelle in der anderen, etwa
        eine knallende Tür, die beide Geräte hören. Liegt eine der beiden Aufnahmen schon sicher, gleicht das die Uhr
        des anderen Geräts ab.
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
        {side("Erste Aufnahme", a, setA, aAt, setAAt)}
        <span className="pl-1 text-[0.8rem] text-muted">ist derselbe Moment wie</span>
        {side("Zweite Aufnahme", b, setB, bAt, setBAt)}
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Choice
            label="Genauigkeit des Ankers"
            value={precision}
            onChange={setPrecision}
            options={PRECISION_OPTIONS}
          />
          <input
            className="w-64"
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
