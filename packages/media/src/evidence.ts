/**
 * Aus ausgelesenen Metadaten und Dateinamen Zeitbelege machen (rein, ohne I/O).
 */
import { localMs, isValidLocal, timeFromFilename, type SourceKind, type TimeEvidence } from "@feldspur/core";
import type { ImageExif, MediaProbe } from "./probe.ts";

export type EvidenceDraft = Omit<TimeEvidence, "id" | "sourceId" | "enabled">;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?$/;

interface ParsedStamp {
  /** Wanduhrzeit wie geschrieben. */
  local: number;
  /** UTC, falls eine Zone angegeben war. */
  utc: number | null;
  zone: string | null;
}

/** "2026-09-14T10:18:47.000000Z", "2026-09-14T10:15:00+0200", "2026:09:14 10:12:34" */
export function parseStamp(text: string): ParsedStamp | null {
  const norm = text.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const m = ISO_RE.exec(norm);
  if (!m) return null;
  const [Y, M, D, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (!isValidLocal(Y, M, D, h, mi, s)) return null;
  // Platzhalter-Daten alter Geräte (1904, 1970, 2000-01-01) sind keine Zeitangabe.
  if (Y < 2000 || (Y === 2000 && M === 1 && D === 1)) return null;
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  const local = localMs(Y, M, D, h, mi, s, ms);
  const zone = m[8] ?? null;
  let utc: number | null = null;
  if (zone === "Z") utc = local;
  else if (zone) {
    const sign = zone.startsWith("-") ? -1 : 1;
    const digits = zone.replace(/[^0-9]/g, "");
    utc = local - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
  }
  return { local, utc, zone };
}

/**
 * Zeitbelege aus Audio/Video-Metadaten.
 *
 * Reihenfolge der Felder: Apple-Aufnahmedatum (mit echter Ortszeit-Zone),
 * BWF-Felder von Rekordern, dann das allgemeine creation_time.
 * Annahme: Die Angabe bezeichnet den Aufnahmebeginn. Geräte, die das Ende
 * schreiben, müssen später per Geräteeinstellung korrigiert werden.
 */
export function evidenceFromMediaTags(probe: MediaProbe): EvidenceDraft[] {
  const t = probe.tags;
  const out: EvidenceDraft[] = [];
  const apple = t["com.apple.quicktime.creationdate"];
  const appleStamp = apple ? parseStamp(apple) : null;
  if (apple && appleStamp) {
    out.push({
      kind: "metadata",
      clock: "device",
      atMediaMs: 0,
      localMs: appleStamp.local,
      utcMs: null, // schon Ortszeit mit Zone, keine Umrechnung nötig
      uncertaintyMs: 1000,
      detail: "Metadaten (Aufnahmebeginn, Apple)",
      raw: `com.apple.quicktime.creationdate=${apple}`,
    });
  }
  // BWF (WAV von Rekordern): ffprobe zeigt origination_date/-time als "date" und
  // ein reines Uhrzeit-"creation_time"; manche Werkzeuge behalten die Originalnamen.
  const bwfDate =
    t["origination_date"] ?? (/^\d{4}[-:/]\d{2}[-:/]\d{2}$/.test(t["date"] ?? "") ? t["date"] : undefined);
  const bwfTime =
    t["origination_time"] ??
    (/^\d{2}[:.-]\d{2}[:.-]\d{2}$/.test(t["creation_time"] ?? "") ? t["creation_time"] : undefined);
  if (bwfDate && bwfTime) {
    const s = parseStamp(`${bwfDate.replace(/[:/]/g, "-")}T${bwfTime.replace(/[-.]/g, ":")}`);
    if (s) {
      out.push({
        kind: "metadata",
        clock: "device",
        atMediaMs: 0,
        localMs: s.local,
        utcMs: null,
        uncertaintyMs: 1000,
        detail: "Metadaten (BWF Aufnahmebeginn)",
        raw: `origination_date=${bwfDate} origination_time=${bwfTime}`,
      });
    }
  }
  const ct = t["creation_time"];
  const ctStamp = ct ? parseStamp(ct) : null;
  if (ct && ctStamp && out.length === 0) {
    out.push({
      kind: "metadata",
      clock: "device",
      atMediaMs: 0,
      // Viele Geräte schreiben Ortszeit mit "Z". Wie geschrieben lesen; echte UTC
      // wird über die Geräteeinstellung „Zeitstempel sind UTC“ umgerechnet.
      localMs: ctStamp.local,
      utcMs: ctStamp.utc,
      uncertaintyMs: 1000,
      detail: "Metadaten (Aufnahmebeginn)",
      raw: `creation_time=${ct}`,
    });
  }
  return out;
}

export function evidenceFromExif(exif: ImageExif | null): EvidenceDraft[] {
  if (!exif?.dateTimeOriginal) return [];
  const s = parseStamp(exif.dateTimeOriginal);
  if (!s) return [];
  const sub = exif.subSec ? Number(`0.${exif.subSec.replace(/\D/g, "")}`) * 1000 : 0;
  return [
    {
      kind: "metadata",
      clock: "device",
      atMediaMs: 0,
      localMs: s.local + Math.round(sub),
      utcMs: null,
      uncertaintyMs: exif.subSec ? 50 : 1000,
      detail: "EXIF",
      raw: `DateTimeOriginal=${exif.dateTimeOriginal}${exif.subSec ? ` SubSec=${exif.subSec}` : ""}${exif.offsetTime ? ` Offset=${exif.offsetTime}` : ""}`,
    },
  ];
}

export function evidenceFromFilename(fileName: string, customPattern?: string | null): EvidenceDraft[] {
  const f = timeFromFilename(fileName, customPattern);
  if (!f) return [];
  return [
    {
      kind: "filename",
      clock: "device",
      atMediaMs: 0,
      localMs: f.localMs,
      utcMs: null,
      uncertaintyMs: f.uncertaintyMs,
      detail: `Dateiname „${f.matched}“`,
      raw: fileName,
    },
  ];
}

/** Welche Belege für eine Quellenart sinnvoll sind. Bei Tagebuchscans ist die Scanzeit keine Notierzeit. */
export function evidenceAppliesTo(kind: SourceKind): boolean {
  return kind !== "diary" && kind !== "note";
}
