/**
 * Fertige automatische Transkripte einlesen (z. B. Whisper, WhisperX, MacWhisper, noScribe):
 * SubRip (.srt), WebVTT (.vtt), Whisper-JSON (.json) und Whisper-TSV (.tsv).
 * Jede Zeile behält ihre Stelle in der Aufnahme; die Uhrzeit folgt wie bei der Mitschrift aus dem Abgleich.
 */

export interface ImportedLine {
  atMs: number;
  speaker: string;
  text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function stamp(s: string): number | null {
  const m = TIME.exec(s);
  if (!m) return null;
  const [h, mi, se, frac] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3]), m[4]!.padEnd(3, "0")];
  return ((h * 60 + mi) * 60 + se) * 1000 + Number(frac);
}

/** „SPEAKER_00“ (Diarisierung) → „S1“; „[Interviewer]:“, „<v Anna>“ und „Anna:“ bleiben als Name. */
function speakerName(raw: string): string {
  const t = raw.trim();
  const m = /^SPEAKER[_ ]?(\d+)$/i.exec(t);
  return m ? `S${Number(m[1]) + 1}` : t;
}

/** Sprecher am Zeilenanfang abtrennen: „[SPEAKER_01]: …“, „SPEAKER_01: …“, „<v Anna>…“, „(B1) …“. */
function splitSpeaker(text: string): { speaker: string; text: string } {
  const t = text.trim();
  let m = /^<v(?:\.[^ >]*)?\s+([^>]+)>\s*([\s\S]*?)(?:<\/v>)?$/.exec(t);
  if (m) return { speaker: speakerName(m[1]!), text: m[2]!.trim() };
  m = /^\[([^\]]{1,40})\]:?\s*([\s\S]*)$/.exec(t);
  if (m) return { speaker: speakerName(m[1]!), text: m[2]!.trim() };
  m = /^(SPEAKER[_ ]?\d+)\s*:\s*([\s\S]*)$/i.exec(t);
  if (m) return { speaker: speakerName(m[1]!), text: m[2]!.trim() };
  return { speaker: "", text: t };
}

const clean = (s: string) =>
  s
    .replace(/<\/?(?:i|b|u|c|v)[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** SRT und VTT: Blöcke mit „Beginn --> Ende“ und Text. */
function parseCues(text: string): ImportedLine[] {
  const out: ImportedLine[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const at = stamp(lines[i]!.split("-->")[0]!);
    if (at === null) continue;
    const body = lines.slice(i + 1).join("\n");
    const sp = splitSpeaker(body);
    const t = clean(sp.text);
    if (t) out.push({ atMs: at, speaker: sp.speaker, text: t });
  }
  return out;
}

interface WhisperSegment {
  start?: number;
  text?: string;
  speaker?: string;
}

/** Whisper/WhisperX-JSON: { segments: [{ start (s), text, speaker? }] } oder direkt ein Array. */
function parseJson(text: string): ImportedLine[] {
  const data = JSON.parse(text) as { segments?: WhisperSegment[] } | WhisperSegment[];
  const segs = Array.isArray(data) ? data : (data.segments ?? []);
  if (!Array.isArray(segs) || !segs.length) throw new Error("Keine Segmente im JSON gefunden");
  return segs.flatMap((s) => {
    if (typeof s.start !== "number" || typeof s.text !== "string") return [];
    const sp = s.speaker ? { speaker: speakerName(s.speaker), text: s.text } : splitSpeaker(s.text);
    const t = clean(sp.text);
    return t ? [{ atMs: Math.round(s.start * 1000), speaker: sp.speaker, text: t }] : [];
  });
}

/** Whisper-TSV: „start	end	text“ in Millisekunden, mit Kopfzeile. */
function parseTsv(text: string): ImportedLine[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((line) => {
      const [start, , ...rest] = line.split("\t");
      if (!start || !/^\d+$/.test(start)) return [];
      const sp = splitSpeaker(rest.join("\t"));
      const t = clean(sp.text);
      return t ? [{ atMs: Number(start), speaker: sp.speaker, text: t }] : [];
    });
}

export function parseTranscript(text: string, fileName: string): ImportedLine[] {
  const ext = fileName.toLowerCase().split(".").pop();
  const body = text.replace(/^﻿/, "");
  let lines: ImportedLine[];
  if (ext === "json") lines = parseJson(body);
  else if (ext === "tsv") lines = parseTsv(body);
  else if (ext === "srt" || ext === "vtt" || body.includes("-->")) lines = parseCues(body);
  else throw new Error("Unbekanntes Format. Möglich sind .srt, .vtt, .json und .tsv (z. B. aus Whisper).");
  if (!lines.length) throw new Error("Im Transkript wurden keine Zeilen mit Zeitangabe gefunden");
  return lines.sort((a, b) => a.atMs - b.atMs);
}

export const TRANSCRIPT_EXTENSIONS = ["srt", "vtt", "json", "tsv"];
