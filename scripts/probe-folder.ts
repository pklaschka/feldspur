/**
 * Entwicklerwerkzeug: Ordner einsammeln, in ein Projekt im Speicher importieren
 * und die Tabelle aus Skizze A ausgeben.
 *
 *   pnpm probe <ordner> [--reference <dateiname>] [--anchor <a.ext>@<sek>=<b.ext>@<sek>] [--diary <datei>@<hh:mm>]
 */
import { formatClock, formatDuration, localMs, ProjectStore, resolveTimeline } from "@feldspur/core";
import { applyImport, scanPaths } from "@feldspur/media";

const args = process.argv.slice(2);
const folders: string[] = [];
const refs: string[] = [];
const anchors: string[] = [];
const diary: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--reference") refs.push(args[++i]!);
  else if (a === "--anchor") anchors.push(args[++i]!);
  else if (a === "--diary") diary.push(args[++i]!);
  else folders.push(a);
}
if (!folders.length) {
  console.error("Aufruf: pnpm probe <ordner> [--reference datei] [--anchor a@s=b@s] [--diary datei@hh:mm]");
  process.exit(1);
}

const candidates = await scanPaths(folders);
const store = ProjectStore.open(":memory:");
const firstDate = candidates.flatMap((c) => c.evidence)[0]?.localMs ?? Date.now();
const day = new Date(firstDate).toISOString().slice(0, 10);
const session = store.addSession({ title: "Probe", date: day });
applyImport(store, session.id, candidates);

const byName = new Map(store.listSources(session.id).map((s) => [s.fileName, s]));
const need = (name: string) => {
  const s = byName.get(name);
  if (!s) throw new Error(`Datei nicht im Import: ${name}`);
  return s;
};
for (const r of refs) store.setReferenceDevice(need(r).deviceId!);
for (const a of anchors) {
  const m = /^(.+)@([\d.]+)=(.+)@([\d.]+)$/.exec(a);
  if (!m) throw new Error(`Anker-Format: a.ext@sek=b.ext@sek, nicht ${a}`);
  store.addAnchor({
    sessionId: session.id,
    kind: "clap",
    a: { sourceId: need(m[1]!).id, atMediaMs: Math.round(Number(m[2]) * 1000) },
    b: { sourceId: need(m[3]!).id, atMediaMs: Math.round(Number(m[4]) * 1000) },
  });
}
const [Y, M, D] = day.split("-").map(Number) as [number, number, number];
for (const d of diary) {
  const m = /^(.+)@(\d{1,2}):(\d{2})$/.exec(d);
  if (!m) throw new Error(`Tagebuch-Format: datei@hh:mm, nicht ${d}`);
  store.addDiaryEntry({
    sessionId: session.id,
    regions: [{ sourceId: need(m[1]!).id }],
    notedAtMs: localMs(Y, M, D, Number(m[2]), Number(m[3])),
  });
}

const input = store.loadResolveInput(session.id);
const res = resolveTimeline(input);
const devices = new Map(input.devices.map((d) => [d.id, d]));
const STATUS = { ok: "● sicher", check: "● prüfen", unplaced: "● zuordnen" } as const;
const rows = input.sources.map((s) => {
  const p = res.placements.get(s.id);
  const dev = s.deviceId ? devices.get(s.deviceId) : undefined;
  const lage = p
    ? p.endMs > p.startMs
      ? `${formatClock(p.startMs)} – ${formatClock(p.endMs)}`
      : formatClock(p.startMs)
    : "?";
  const status = p ? [STATUS[p.status], ...p.notes].join(" · ") : STATUS.unplaced;
  const korr = p?.deviceCorrectionMs ? formatDuration(p.deviceCorrectionMs, { sign: true }) : "";
  return [s.label, s.fileName, dev?.label ?? "", p?.basis.detail ?? "–", korr, lage, status];
});
const head = ["Quelle", "Datei", "Gerät", "Zeit erkannt aus", "Korrektur", "Lage", "Status"];
const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i]!)).join("  ");
console.log(line(head));
console.log(w.map((n) => "─".repeat(n)).join("  "));
for (const r of rows) console.log(line(r));
for (const c of res.deviceClocks.values()) {
  if (c.basis === "anchor") {
    console.log(
      `\n${devices.get(c.deviceId)?.label}: Uhr ${formatDuration(c.offsetMs ?? 0, { sign: true })} gegenüber Referenz (aus Anker)`,
    );
  }
}
store.close();
