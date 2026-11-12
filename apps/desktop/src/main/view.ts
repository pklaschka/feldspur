import { formatClock, resolveTimeline, type ProjectStore } from "@feldspur/core";
import type { DeviceRow, SessionView, SourceRow } from "../shared/api.ts";

/** Einsatz laden, Zeitbestimmung rechnen und als Tabellenzeilen aufbereiten. */
export function buildSessionView(store: ProjectStore, sessionId: string): SessionView {
  const input = store.loadResolveInput(sessionId);
  const res = resolveTimeline(input);
  const persons = new Map(store.listPersons().map((p) => [p.id, p.name]));
  const devices = new Map(input.devices.map((d) => [d.id, d]));

  const rows: SourceRow[] = input.sources.map((s) => {
    const p = res.placements.get(s.id);
    const entry = input.diaryEntries.find((e) => e.regions.some((r) => r.sourceId === s.id) && e.notedAtMs !== null);
    const d = s.deviceId ? devices.get(s.deviceId) : undefined;
    return {
      id: s.id,
      label: s.label,
      kind: s.kind,
      fileName: s.fileName,
      deviceId: s.deviceId,
      deviceLabel: d?.label ?? "",
      personName: d?.personId ? (persons.get(d.personId) ?? "") : "",
      basis: p?.basis.detail ?? "nichts gefunden",
      startMs: p?.startMs ?? null,
      endMs: p?.endMs ?? null,
      correctionMs: p?.deviceCorrectionMs ?? 0,
      diaryNote: s.kind === "diary" && entry?.notedAtMs != null ? formatClock(entry.notedAtMs).slice(0, 5) : null,
      status: p?.status ?? "unplaced",
      notes: p?.notes ?? [],
    };
  });
  rows.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.label.localeCompare(b.label));

  // Geräte ohne eigene Uhr (nur Tagebuchscans, Notizen) brauchen keinen Abgleich.
  const clocked = input.devices.filter((d) =>
    input.sources.some((s) => s.deviceId === d.id && s.kind !== "diary" && s.kind !== "note"),
  );
  const deviceRows: DeviceRow[] = clocked.map((d) => {
    const c = res.deviceClocks.get(d.id);
    return {
      id: d.id,
      label: d.label,
      isReference: d.isReference,
      offsetMs: c?.offsetMs ?? null,
      offsetBasis: c?.basis ?? "unknown",
      sourceCount: input.sources.filter((s) => s.deviceId === d.id).length,
    };
  });

  return { session: input.session, rows, devices: deviceRows };
}
