/** Spuren der Zeitachse: Reihenfolge, Höhe, Untertitel und Startzeit einer Quelle. */
import type { DeviceRow, SourceRow } from "../../shared/api.ts";
import type { Track } from "../timeline.ts";

/** Reihenfolge der Spuren nach Art des Geräts (Referenzuhr steht immer oben). */
export const KIND_ORDER = ["video", "audio", "photo", "diary", "note", "gps", "other"];

/** Spuren: Referenzuhr zuerst, dann nach Art; Quellen ohne Gerät zuletzt in einer eigenen Spur. */
export function buildTracks(devices: DeviceRow[], placed: SourceRow[]): Track[] {
  const sorted = devices.toSorted(
    (a, b) => Number(b.isReference) - Number(a.isReference) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const list: Track[] = sorted.map((d) => ({ device: d, rows: placed.filter((r) => r.deviceId === d.id) }));
  const loose = placed.filter((r) => !r.deviceId);
  if (loose.length) list.push({ device: null, rows: loose });
  return list;
}

/** Höhe einer Spur: die freie Höhe geteilt durch die Spuren, zwischen 52 und 88 px. */
export const trackHeightFor = (free: number, tracks: number) =>
  Math.max(52, Math.min(88, Math.floor(free / Math.max(1, tracks))));

/** Startzeit einer Quelle auf der Achse; Tagebuchseiten stehen am Ende ihres Bezugszeitraums. */
export const rowStart = (r: SourceRow) => r.startMs ?? r.diaryWindow?.toMs ?? 0;

/** Untertitel einer Spur: Referenz, Person oder Anzahl, dazu was noch ohne Zeit ist. */
export function trackSub(t: Track, rows: SourceRow[]): string {
  if (!t.device) return `${t.rows.length} ${t.rows.length === 1 ? "Datei" : "Dateien"}`;
  const all = rows.filter((r) => r.deviceId === t.device!.id && !r.partOf);
  const open = all.filter((r) => r.startMs === null && !r.diaryWindow).length;
  const base = t.device.isReference
    ? "Referenzuhr"
    : t.device.personName || `${all.length} ${all.length === 1 ? "Datei" : "Dateien"}`;
  // Offene Widersprüche zählen mit, damit man sie auch bei weggezoomter Achse findet.
  const conflicts = all.filter((r) => r.conflict.state === "open" || r.conflict.state === "stale").length;
  return [base, open ? `${open} ohne Zeit` : "", conflicts ? `${conflicts} ≠` : ""].filter(Boolean).join(" · ");
}
