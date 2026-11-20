/**
 * Viewer (Issue #122): eine HTML-Datei neben dem Montagevideo. Sie zeigt das Einsatztranskript synchron zum Video,
 * mit Bildern, Kontext, Zeitleiste und auf Wunsch den Gerätespuren einzeln.
 *
 * Das Einsatztranskript steht als fertiges HTML in der Datei (lesbar und druckbar auch ohne Skript); das Skript hängt
 * nur Verhalten an. Alles ist eingebettet (Schriften, Bilder, Skript), nichts wird nachgeladen. Die Datei muss in
 * jedem heutigen Browser laufen, nicht nur in Chromium (siehe AGENTS.md).
 */
import { formatClock, type Id, type MontagePlan } from "@feldspur/core";
import type { Envelope } from "../audio.ts";
import { FPS } from "../layout.ts";
import { deviceTracksOf, planPieces } from "../montage-video.ts";
import {
  timestamp,
  type SessionTranscript,
  type SessionTranscriptContext,
  type SessionTranscriptEntry,
} from "../session-transcript.ts";
import type { Still } from "../stills.ts";
import { VIEWER_FONTS } from "./fonts.ts";
import { readMp4Audio } from "./mp4-audio.ts";
import { viewerMain } from "./runtime.ts";
import { VIEWER_CSS } from "./style.ts";

/** Fassung der eingebetteten Daten (feldspur-daten). */
export const VIEWER_DATA_VERSION = 1;

export interface ViewerOptions {
  /** Dateiname des Montagevideos im selben Ordner. */
  mediaFileName: string;
  stills: Map<SessionTranscriptEntry, (Still | null)[]>;
  contextStills?: Map<SessionTranscriptContext, (Still | null)[]>;
  /** Tonspuren im Montagevideo, in ihrer Reihenfolge (Spur 1: Mischung). Ohne Angabe nur die Mischung. */
  audioTracks?: { title: string; deviceId?: Id }[];
  /** Hüllkurven der Aufnahmen (Tonspur-Analyse), je Quelle. Daraus die Wellenform in den Gerätespuren. */
  envelopes?: Map<Id, Envelope>;
}

/** Daten für das Skript; alles Übrige steht als HTML in der Seite. Zeiten in ms Videozeit. */
export interface ViewerData {
  v: number;
  title: string;
  date: string;
  montageId: string;
  mediaFile: string;
  durationMs: number;
  realtime: boolean;
  /** e: Episode, g: Zwischenzeit in Echtzeit, c: kurze Tafel (Uhrzeit steht still). */
  segments: { k: "e" | "g" | "c"; n?: number; m0: number; m1: number; c0: number; c1: number }[];
  /** Tonspuren im Video; Spur 0 ist die Mischung. */
  audio: string[];
  lanes: {
    title: string;
    kind: "audio" | "video";
    ref: boolean;
    /** Index der eigenen Tonspur im Video, sonst -1. */
    audio: number;
    /** w: Hüllkurve als Base64 (ein Byte je Wert, 0 = still), ws: Abstand der Werte in ms. */
    clips: { label: string; file: string; m0: number; m1: number; w?: string; ws?: number }[];
  }[];
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);
const p2 = (n: number) => String(n).padStart(2, "0");

/** Videozeit wie „1:02:03“. */
export function videoTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
}

/** Uhrzeit an einer Stelle des Videos; in einer Tafel der Beginn der Zwischenzeit. */
export function clockAtMontage(plan: MontagePlan, ms: number): number {
  const seg =
    plan.segments.find((s) => ms >= s.montageStartMs && ms < s.montageStartMs + s.montageMs) ?? plan.segments.at(-1);
  if (!seg) return 0;
  const linear = seg.kind === "episode" || plan.mode === "realtime";
  return linear ? seg.fromMs + Math.min(ms - seg.montageStartMs, seg.toMs - seg.fromMs) : seg.fromMs;
}

const ICON: Record<string, string> = {
  audio: "M8 2.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2ZM4 8a4 4 0 0 0 8 0M8 12v2.5",
  video: "M3 5.5h7.5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM11.5 8.2 15 6v6l-3.5-2.2",
  photo:
    "M2.5 5h2.2l1.2-1.5h4.2L11.3 5h2.2a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 7a2.3 2.3 0 1 0 0 4.6A2.3 2.3 0 0 0 8 7Z",
  diary: "M4 2.5h7.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4ZM4 2.5v11M2.8 5h2.4M2.8 8h2.4M2.8 11h2.4M7 5.5h3.5M7 8h3.5",
  sync: "M10.5 3l3 3-3 3M13.5 6h-7a4 4 0 0 0 0 8H9",
  card: "M4 8h.01M8 8h.01M12 8h.01",
  end: "M4 3v10M4 3.3h8v5H4",
};
const icon = (k: string) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
const svg = (d: string, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
const CLOSE = svg("m4 4 8 8M12 4l-8 8");
const FLAG = `<svg viewBox="0 0 13 14" aria-hidden="true"><path d="M1.5 1v12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1.5 1.2 12 4.2 1.5 7.2Z" fill="currentColor"/></svg>`;
const SYMBOL = `<svg class="symbol" viewBox="64 64 896 896" role="img" aria-label="Feldspur"><defs><linearGradient id="sym-bg" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#e6ab68"/><stop offset="1" stop-color="#bf5f34"/></linearGradient><linearGradient id="sym-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdf6e9"/><stop offset="1" stop-color="#f3e5cc"/></linearGradient></defs><rect x="64" y="64" width="896" height="896" rx="200" fill="url(#sym-bg)"/><g transform="rotate(-4 512 540)"><rect x="196" y="250" width="632" height="560" rx="48" fill="#6e3218" opacity="0.28" transform="translate(8 20)"/><rect x="196" y="250" width="632" height="560" rx="48" fill="url(#sym-paper)"/><rect x="262" y="368" width="330" height="72" rx="36" fill="#7f8f5a"/><rect x="404" y="494" width="358" height="72" rx="36" fill="#d07a3e"/><rect x="300" y="620" width="250" height="72" rx="36" fill="#a8452c"/></g><line x1="522" y1="222" x2="522" y2="840" stroke="#3a281d" stroke-width="30" stroke-linecap="round"/><path d="M522 218 L 700 270 L 522 322 Z" fill="#3a281d" stroke="#3a281d" stroke-width="22" stroke-linejoin="round"/></svg>`;

/** Content-Security-Policy: keine Netzzugriffe, nur Eingebettetes und das Video daneben. */
export const VIEWER_CSP =
  "default-src 'none'; img-src data: blob:; media-src 'self' file: blob: data:; style-src 'unsafe-inline'; " +
  "script-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/** Wellenform: höchstens so viele Werte je Aufnahme, nicht feiner als WAVE_STEP_MS. */
const WAVE_MAX = 4000;
const WAVE_STEP_MS = 250;
/** Leiser als das zählt in der Wellenform als Stille (wie WAVEFORM_FLOOR_DB in der App). */
const WAVE_FLOOR_DB = -60;

/** Anhebung in dB, damit auch leise Aufnahmen eine lesbare Wellenform bekommen (laute Stellen bei etwa −6 dB). */
function waveBoost(env: Envelope): number {
  if (!env.db.length) return 0;
  const sorted = env.db.toSorted();
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))]!;
  return Math.min(30, Math.max(0, -6 - loud));
}

/** Hüllkurve eines Ausschnitts für die Zeitleiste: je Wert der lauteste Pegel, 0 … 255. */
export function waveOf(env: Envelope, fromMs: number, durMs: number, boostDb = 0): { w: string; ws: number } {
  const stepMs = Math.max(WAVE_STEP_MS, durMs / WAVE_MAX);
  const n = Math.max(1, Math.ceil(durMs / stepMs));
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, Math.floor(((fromMs + i * stepMs) / 1000) * env.rate));
    const b = Math.min(env.db.length, Math.max(a + 1, Math.floor(((fromMs + (i + 1) * stepMs) / 1000) * env.rate)));
    let db = -Infinity;
    for (let k = a; k < b; k++) if (env.db[k]! > db) db = env.db[k]!;
    out[i] = Math.round(Math.min(1, Math.max(0, 1 - (db + boostDb) / WAVE_FLOOR_DB)) * 255);
  }
  return { w: out.toString("base64"), ws: Math.round(stepMs) };
}

/** Spuren je Gerät mit ihren Aufnahmen in Videozeit, in derselben Reihenfolge wie die Gerätespuren im Video. */
function lanesOf(
  transcript: SessionTranscript,
  audioTracks: { title: string; deviceId?: Id }[],
  envelopes?: Map<Id, Envelope>,
): ViewerData["lanes"] {
  const pieces = planPieces(transcript);
  const frameMs = 1000 / FPS;
  const clips = new Map<Id, { label: string; file: string; f0: number; f1: number; source: Id; fromMs: number }[]>();
  const boosts = new Map<Id, number>();
  const wave = (c: { source: Id; fromMs: number; f0: number; f1: number }) => {
    const env = envelopes?.get(c.source);
    if (!env) return {};
    if (!boosts.has(c.source)) boosts.set(c.source, waveBoost(env));
    return waveOf(env, c.fromMs, (c.f1 - c.f0) * frameMs, boosts.get(c.source));
  };
  const kinds = new Map<Id, Set<string>>();
  for (const p of pieces)
    for (const a of p.audios) {
      const dev = a.source.deviceId;
      if (!dev) continue;
      if (!kinds.has(dev)) kinds.set(dev, new Set());
      kinds.get(dev)!.add(a.source.kind);
      const list = clips.get(dev) ?? [];
      clips.set(dev, list);
      const last = list.findLast((c) => c.label === a.source.label);
      if (last && last.f1 === p.f0) last.f1 = p.f1;
      else
        list.push({
          label: a.source.label,
          file: a.source.fileName,
          f0: p.f0,
          f1: p.f1,
          source: a.source.id,
          fromMs: a.fromMs,
        });
    }
  const ref = transcript.input.devices.find((d) => d.isReference)?.id;
  return deviceTracksOf(transcript, pieces).map((d) => ({
    title: d.title,
    kind: kinds.get(d.deviceId)?.has("video") ? "video" : "audio",
    ref: d.deviceId === ref,
    audio: audioTracks.findIndex((t, k) => k > 0 && t.deviceId === d.deviceId),
    clips: (clips.get(d.deviceId) ?? [])
      .toSorted((a, b) => a.f0 - b.f0)
      .map((c) => ({
        label: c.label,
        file: c.file,
        m0: Math.round(c.f0 * frameMs),
        m1: Math.round(c.f1 * frameMs),
        ...wave(c),
      })),
  }));
}

export function viewerData(
  transcript: SessionTranscript,
  opts: Pick<ViewerOptions, "mediaFileName" | "audioTracks" | "envelopes">,
): ViewerData {
  const { plan, header } = transcript;
  const audioTracks = opts.audioTracks ?? [{ title: "Ton" }];
  return {
    v: VIEWER_DATA_VERSION,
    title: header.title,
    date: displayDate(header.date),
    montageId: header.montageId,
    mediaFile: opts.mediaFileName,
    durationMs: Math.round(plan.durationMs),
    realtime: plan.mode === "realtime",
    segments: plan.segments.map((s) => ({
      k: s.kind === "episode" ? "e" : plan.mode === "realtime" ? "g" : "c",
      ...(s.kind === "episode" && transcript.episodes ? { n: s.episode.index } : {}),
      m0: Math.round(s.montageStartMs),
      m1: Math.round(s.montageStartMs + s.montageMs),
      c0: Math.round(s.fromMs),
      c1: Math.round(s.toMs),
    })),
    audio: audioTracks.map((t) => t.title),
    lanes: lanesOf(transcript, audioTracks, opts.envelopes),
  };
}

function imageButton(still: Still | null, caption: string, missing: string): string {
  if (!still) return `<span class="noimg">${esc(missing)}</span>`;
  const src = `data:image/jpeg;base64,${still.data.toString("base64")}`;
  return `<button class="img" type="button" aria-label="Bild vergrößern: ${esc(caption)}"><img src="${src}" width="${still.width}" height="${still.height}" alt="${esc(caption)}" loading="lazy" decoding="async"></button>`;
}

function images(
  refs: SessionTranscriptEntry["images"],
  stills: (Still | null)[],
  caption: string,
  scanOnly: boolean,
): string {
  if (!refs.length) return "";
  const alt = scanOnly ? `${caption} (nur Scan, nicht abgetippt)` : caption;
  return `<div class="imgs">${refs
    .map((r, i) =>
      imageButton(
        stills[i] ?? null,
        alt,
        `[Scan ${r.region ? `S. ${r.region.page + 1} ` : ""}nicht eingebettet, siehe Originaldatei]`,
      ),
    )
    .join("")}</div>`;
}

function entryHtml(
  t: SessionTranscript,
  e: SessionTranscriptEntry,
  i: number,
  stills: (Still | null)[],
  ctx: { keyToId: Map<string, string>; names: Map<string, string> },
  lastSrc: { v: string },
): string {
  const clockMs = clockAtMontage(t.plan, e.montageMs);
  const gutter = e.kind === "diary" ? e.clock.slice(0, 5) : (e.clock.split("–")[0] ?? "") || formatClock(clockMs);
  const jump = e.kind === "end" ? "Zum Ende springen" : `Zu ${gutter} springen`;
  const tm = `<button class="tm num" type="button" aria-label="${esc(jump)}"><span class="c">${esc(gutter)}</span><span class="v">${videoTime(e.montageMs)}</span><span class="m">${timestamp(e.montageMs)}</span></button>`;
  const glyph =
    e.kind === "start"
      ? icon(e.head.startsWith("Video") ? "video" : "audio")
      : e.kind === "line"
        ? '<i class="dot"></i>'
        : ICON[e.kind]
          ? icon(e.kind)
          : "";
  const gl = `<span class="gl" aria-hidden="true">${glyph}</span>`;
  let tx = "";
  if (e.kind === "episode") {
    const n = Number(/\d+/.exec(e.head)?.[0] ?? 0);
    const eps = t.plan.segments.filter((s) => s.kind === "episode").length;
    const lage = t.plan.segments
      .map((s) => {
        const cls = s.kind === "episode" ? (s.episode.index === n ? "on" : "") : "g";
        return `<i class="${cls}" style="flex:${Math.max(1, Math.round((s.toMs - s.fromMs) / 1000))} 1 0"></i>`;
      })
      .join("");
    tx = `<h2>${esc(e.head)}</h2><span class="body num">${esc(e.body)}</span><span class="lage" title="Episode ${n} von ${eps}">${lage}</span>`;
  } else {
    let body = e.body;
    if (e.kind === "line") {
      if (e.head && e.head !== lastSrc.v)
        tx += `<span class="src" title="Mitschrift aus ${esc(e.head)}">${esc(e.head)}</span> `;
      if (e.head) lastSrc.v = e.head;
      if (e.speaker && body.startsWith(`${e.speaker}: `)) {
        tx += `<span class="sp">${esc(e.speaker)}: </span>`;
        body = body.slice(e.speaker.length + 2);
      }
    } else {
      tx += `<span class="hd">${esc(e.head)}${e.kind === "diary" || e.kind === "card" ? "" : ": "}</span>`;
    }
    if (e.kind === "diary") {
      const rest = e.clock.replace(/^\S+ \(/, "").replace(/\)$/, "");
      if (rest !== e.clock) tx += `<span class="ck num"> · ${esc(rest)}</span>`;
      tx += "<br>";
    }
    if (e.kind === "card" && e.clock) tx += `<span class="ck num"> · ${esc(e.clock)} · </span>`;
    const refs = (e.contextRefs ?? []).filter((k) => ctx.keyToId.has(k));
    const refText = ` → Kontext: ${refs.map((k) => ctx.names.get(k)).join("; ")}`;
    if (refs.length && body.endsWith(refText)) body = body.slice(0, -refText.length);
    tx += `<span class="body">${esc(body)}</span>`;
    if (refs.length)
      tx += `<span class="refs"> ${refs
        .map(
          (k) =>
            `<button class="ref" type="button" data-ctx="${ctx.keyToId.get(k)}" aria-label="Kontext zeigen: ${esc(ctx.names.get(k)!)}"><span class="kmark" aria-hidden="true">→K</span>${esc(ctx.names.get(k)!)}</button>`,
        )
        .join(" ")}</span>`;
    tx += images(
      e.images,
      stills,
      `${e.head} · Uhrzeit ${e.kind === "diary" ? e.clock.slice(0, 5) : e.clock}`,
      /: nur Scan$|^nur Scan/.test(e.body),
    );
  }
  return `<li class="ln k-${e.kind}" data-i="${i}" data-m="${Math.round(e.montageMs)}">${tm}${gl}<div class="tx">${tx}</div></li>`;
}

/** Angaben zum Kontextstück; die Uhrzeiten hinter „erwähnt um“ springen zur erwähnenden Zeile. */
function contextDetails(details: string, mentions: number[]): string {
  const text = details.replace(/^[\s·,]+/, "");
  const m = /^(.*erwähnt um )(.+)$/s.exec(text);
  const times = m?.[2]!.split(", ") ?? [];
  if (!m || times.length !== mentions.length) return esc(text);
  return `${esc(m[1]!)}${times
    .map(
      (t, i) =>
        `<button class="num" type="button" data-m="${Math.round(mentions[i]!)}" title="Zur Stelle im Einsatztranskript">${esc(t)}</button>`,
    )
    .join(", ")}`;
}

function contextHtml(c: SessionTranscriptContext, id: string, stills: (Still | null)[], mentions: number[]): string {
  const name = c.head.replace(/^Kontext · /, "");
  return `<li class="c-item" id="${id}"><h3>${esc(name)}</h3>${c.details ? `<p class="det">${contextDetails(c.details, mentions)}</p>` : ""}${images(c.images, stills, `Kontext · ${name}`, false)}${c.body ? `<p class="body">${esc(c.body)}</p>` : ""}</li>`;
}

function fontCss(): string {
  return VIEWER_FONTS.map(
    (f) =>
      `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};font-display:swap;src:url(data:font/woff2;base64,${f.woff2}) format("woff2")}`,
  ).join("\n");
}

/** Das Skript: Teilfunktionen als Quelltext, ohne Bezüge nach außen (siehe runtime.ts). */
export function viewerScript(): string {
  const js = `"use strict";\n(${viewerMain.toString()})(${readMp4Audio.toString()});`;
  // Ein „</script“ im Quelltext würde das Skript-Element beenden.
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

/** Die ganze Seite. */
export function sessionTranscriptHtml(transcript: SessionTranscript, opts: ViewerOptions): string {
  const h = transcript.header;
  const data = viewerData(transcript, opts);
  const date = displayDate(h.date);
  const keyToId = new Map(transcript.context.map((c, i) => [c.key, `ctx-${i + 1}`]));
  const names = new Map(transcript.context.map((c) => [c.key, c.head.replace(/^Kontext · /, "")]));
  const lastSrc = { v: "" };
  const lines = transcript.entries
    .map((e, i) => entryHtml(transcript, e, i, opts.stills.get(e) ?? [], { keyToId, names }, lastSrc))
    .join("\n");
  const ctxItems = transcript.context
    .map((c) =>
      contextHtml(
        c,
        keyToId.get(c.key)!,
        opts.contextStills?.get(c) ?? [],
        transcript.entries.filter((e) => e.contextRefs?.includes(c.key)).map((e) => e.montageMs),
      ),
    )
    .join("\n");
  const extra = Object.entries(h.extra).filter(([k, v]) => k.trim() && v.trim());
  const facts: [string, string][] = [
    ...(h.researchers.length ? [["Forschende", h.researchers.join(", ")] as [string, string]] : []),
    ...(h.reference ? [["Referenzuhr", h.reference] as [string, string]] : []),
    ["Mediendatei", opts.mediaFileName],
    ["Montage", `${h.montageId} · ${h.modeLabel}`],
    ...(h.sources.length ? [["Quellen", h.sources.join(", ")] as [string, string]] : []),
    ...extra,
  ];
  const meta = [
    `Feldtag: ${date}${h.place ? `, ${h.place}` : ""}`,
    ...facts.map(([k, v]) => `${k}: ${v}`),
    h.contextCount
      ? `Kontext: ${h.contextCount} ${h.contextCount === 1 ? "Stück" : "Stücke"} ohne Zeitmarke, im Fenster „Kontext“.`
      : "",
    "Am Rand steht die Uhrzeit. Ein Klick auf eine Zeile springt zur Stelle im Video.",
  ].filter(Boolean);
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = `${h.title} · ${date} – Einsatztranskript mit Video`;
  const ctxCount = transcript.context.length;

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${VIEWER_CSP}">
<meta name="generator" content="Feldspur">
<meta name="feldspur-montage-id" content="${esc(h.montageId)}">
<title>${esc(title)}</title>
<style>
${fontCss()}
${VIEWER_CSS}
</style>
</head>
<body>
<div class="app" id="app" data-kontext="zu" data-video="ok" data-ton="mix">

  <section class="stage" id="stage" data-spuren="zu" aria-label="Montagevideo">
    <div class="proj" id="proj">
    <header class="title">
      ${SYMBOL}
      <h1>${esc(h.title)}</h1>
      <span class="sub">${esc([date, h.place].filter(Boolean).join(" · "))}</span>
      <span class="grow"></span>
      <span class="wordmark" aria-hidden="true">Feldspur</span>
    </header>

    <div class="video" id="video" data-playing="false">
      <video id="vid" src="${esc(encodeURIComponent(opts.mediaFileName))}" preload="metadata" playsinline></video>
      <div class="v-play" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4.5 2.5v11l9-5.5z"/></svg></div>
      <div class="v-missing">
        <b>Das Montagevideo liegt nicht neben dieser Datei.</b>
        <p>Erwartet wird <code>${esc(opts.mediaFileName)}</code> im selben Ordner. Das Einsatztranskript rechts lässt sich auch ohne Video lesen.</p>
        <button class="btn line" type="button" id="pick-video">Videodatei wählen …</button>
      </div>
    </div>

    <div class="transport">
      <button class="play" id="play" type="button" aria-label="Abspielen" title="Abspielen (Leertaste)"><svg viewBox="0 0 16 16" id="play-ic"><path d="M4.5 2.5v11l9-5.5z"/></svg></button>
      <button class="btn icon" id="back5" type="button" aria-label="5 Sekunden zurück" title="5 Sekunden zurück (←)">${svg("M7.5 4 3.5 8l4 4M12.5 4l-4 4 4 4")}</button>
      <button class="btn icon" id="fwd5" type="button" aria-label="5 Sekunden vor" title="5 Sekunden vor (→)">${svg("m8.5 4 4 4-4 4M3.5 4l4 4-4 4")}</button>
      <div class="now"><span class="clock num" id="now-clock"></span><small>Uhrzeit</small><span class="vt num" id="now-vt"><span class="w">Video </span><span id="now-vt-t"></span><span class="w" id="now-dur"></span></span></div>
      <button class="btn icon" id="copy" type="button" aria-label="Stelle kopieren" title="Stelle kopieren (Uhrzeit, Zeitmarke, Montage-ID)">${svg("M5.5 5.5V3.8a1.3 1.3 0 0 1 1.3-1.3h5.4a1.3 1.3 0 0 1 1.3 1.3v5.4a1.3 1.3 0 0 1-1.3 1.3h-1.7M3.8 5.5h5.4a1.3 1.3 0 0 1 1.3 1.3v5.4a1.3 1.3 0 0 1-1.3 1.3H3.8a1.3 1.3 0 0 1-1.3-1.3V6.8a1.3 1.3 0 0 1 1.3-1.3Z")}</button>
      <button class="btn only-narrow" id="spuren-btn" type="button" aria-expanded="false">${svg(ICON.audio!)}Tonspuren</button>
      <button class="btn num" id="rate" type="button" aria-label="Tempo" title="Tempo (F7 langsamer, Umschalt+F7 schneller)">1×</button>
      <span class="vol">
        <button class="btn icon" id="mute" type="button" aria-label="Ton aus" aria-pressed="false" title="Ton aus (M)">${svg("M2.5 6.2h2.3L8.2 3.5v9L4.8 9.8H2.5ZM10.6 5.8a3.2 3.2 0 0 1 0 4.4M12.4 4a5.8 5.8 0 0 1 0 8")}</button>
        <input type="range" id="volume" min="0" max="100" value="100" aria-label="Lautstärke">
      </span>
      <button class="btn icon" id="fs" type="button" aria-label="Vollbild" title="Vollbild (F, Doppelklick ins Video)">${svg("M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10", "ic ic-fs-on")}${svg("M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5", "ic ic-fs-off")}</button>
    </div>
    </div>

    <div class="desk">
    <p class="warn-bar" id="warn" role="status" hidden>${svg("M8 2.5 14 13H2ZM8 6.5v3M8 11.3h.01")}<span id="warn-t"></span></p>
    <div class="tl" id="tl" data-zoom="1">
      <div class="grid" id="grid" aria-hidden="true"></div>
      <div class="tl-row ruler"><div class="tl-lab"><div class="zoom" role="group" aria-label="Ausschnitt der Zeitleiste"><button class="btn small line" id="zoom-out" type="button" aria-label="Zeitleiste verkleinern" title="Verkleinern (−, Mausrad über der Zeitleiste; Umschalt+Mausrad verschiebt)">${svg("M3.5 8h9")}</button><button class="btn small line" id="zoom-in" type="button" aria-label="Zeitleiste vergrößern" title="Vergrößern (+, Mausrad über der Zeitleiste; Umschalt+Mausrad verschiebt)">${svg("M3.5 8h9M8 3.5v9")}</button><button class="btn small" id="zoom-all" type="button" title="Ganzen Einsatz zeigen">Alles<span class="lvl num" id="zoom-lvl"></span></button></div></div><div class="tl-track" id="ruler" title="Ziehen verschiebt den Ausschnitt"></div></div>
      <div class="tl-row marks"><div class="tl-lab"></div><div class="tl-track"><div class="zin" id="marks"></div></div></div>
      <div class="tl-row eps"><div class="tl-lab"><span class="cap">${transcript.episodes ? "Episoden" : "Montage"}</span></div><div class="tl-track"><div class="zclip"><div class="zin" id="eps"></div></div><input type="range" id="seek" min="0" step="1" aria-label="Stelle im Video"><div class="focusring"></div></div></div>
      <div class="tl-row tl-head" id="tl-head"><div class="tl-lab"><span class="cap">Tonspuren</span></div><div class="tl-lab"><span id="mix-state"></span><span class="grow"></span><button class="btn small" id="mix-reset" type="button" hidden>Alle hören</button><button class="btn small line ton-btn" id="ton-btn" type="button" aria-haspopup="dialog" hidden><svg class="ic mx" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11M8 2.5v11M12 2.5v11M2.6 5.5h2.8M6.6 10h2.8M10.6 7h2.8"/></svg><svg class="ic ok" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg><span id="ton-lbl">Erweiterte Tonspurkontrolle</span></button></div></div>
      <div id="lanes" style="display:contents"></div>
      <div class="ton-known" role="status"><span><b>Einzelspuren:</b> Der Browser kennt das Video von letztem Mal und fragt nur kurz nach.</span><button class="btn small line" id="ton-again" type="button">Erneut freigeben</button></div>
      <div class="playhead" id="ph"><i></i><svg viewBox="0 0 14 11" aria-hidden="true"><path d="M1 0.6 13 4.4 1 8.4Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></div>
      <div class="tip num" id="tip"></div>
    </div>
    <div class="tl-foot"><span><i class="i-photo"></i>Foto</span><span><i class="i-diary"></i>Tagebuch</span><span id="hit-legend" hidden><i class="i-hit"></i>Treffer</span><span><i class="i-gap"></i>Zwischenzeit</span><span>${FLAG}Referenzuhr</span></div>
    <dl class="facts" id="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd${k === "Montage" ? ' class="num"' : ""}>${esc(v)}</dd>`).join("")}</dl>
    </div>
  </section>

  <main class="sheet" id="sheet" data-folgt="true" aria-label="Einsatztranskript">
    <div class="bar">
      <label class="search">${svg("M10.5 10.5 14 14M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z")}
        <input type="search" id="q" placeholder="Im Text suchen" aria-label="Im Einsatztranskript suchen" autocomplete="off" spellcheck="false">
        <span class="cnt num" id="q-cnt" aria-live="polite"></span>
      </label>
      <button class="btn icon" id="q-prev" type="button" aria-label="Voriger Treffer" hidden>${svg("m4 10 4-4 4 4")}</button>
      <button class="btn icon" id="q-next" type="button" aria-label="Nächster Treffer" hidden>${svg("m4 6 4 4 4-4")}</button>
      <span class="grow"></span>
      <button class="btn sw" id="follow" type="button" role="switch" aria-checked="true" title="Text läuft mit (T)"><span class="knob" aria-hidden="true"></span><span><span class="w">Text </span>läuft mit</span></button>
      <details class="menu" id="ansicht">
        <summary class="btn" aria-label="Ansicht">${svg("M2.5 13 6 3.5 9.5 13M3.8 9.8h4.4M11 13l1.8-5 1.7 5M11.6 11.4h2.3")}<span class="lbl">Ansicht</span><span class="badge num" id="hidden-n" hidden></span></summary>
        <div class="pop">
          <fieldset><legend>Zeilen zeigen</legend><div class="kinds" id="chips"></div></fieldset>
          <fieldset><legend>Schriftgröße</legend><div class="seg3" id="fsz"><button type="button" data-v="0.9">klein</button><button type="button" data-v="1" aria-pressed="true">normal</button><button type="button" data-v="1.15">groß</button></div></fieldset>
          <fieldset><legend>Zeit am Rand</legend><div class="seg3" id="zeit"><button type="button" data-v="uhr" aria-pressed="true">Uhrzeit</button><button type="button" data-v="video">Videozeit</button><button type="button" data-v="marke">#Marke#</button></div></fieldset>
          <fieldset><legend>Hell oder dunkel</legend><div class="seg3" id="theme"><button type="button" data-v="" aria-pressed="true">System</button><button type="button" data-v="light">hell</button><button type="button" data-v="dark">dunkel</button></div></fieldset>
        </div>
      </details>
      ${ctxCount ? `<button class="btn line" id="ctx-btn" type="button" aria-expanded="false" aria-controls="context" title="Kontext (C)"><span class="kmark" aria-hidden="true">K</span>Kontext <span class="num">${ctxCount}</span></button>` : ""}
      <button class="btn icon" id="keys-btn" type="button" aria-label="Tastenkürzel" title="Tastenkürzel (?)"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="4" width="13" height="8.5" rx="1.5"/><path d="M4 6.8h.01M6.7 6.8h.01M9.3 6.8h.01M12 6.8h.01M5 9.8h6"/></svg></button>
    </div>
    <div class="scroll" id="scroll" tabindex="-1">
      <p class="filtered" id="filtered" hidden><span id="filtered-t"></span> <button class="ref" type="button" id="show-all">alle zeigen</button></p>
      <div class="meta" id="meta">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>
      <ol class="tr" id="tr" data-zeit="uhr">
${lines}
      </ol>
      <p class="empty" id="empty">Keine Zeile passt zu dieser Auswahl.</p>
    </div>
    <div class="toast" id="toast" role="status"></div>
    <button class="back" id="back" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5"/></svg>Zur aktuellen Stelle <span class="num" id="back-t"></span></button>
  </main>

  <aside class="context" id="context" aria-label="Kontext">
    <div class="c-head"><span class="kmark" aria-hidden="true">K</span><h2>Kontext</h2><span class="grow"></span><button class="btn icon" id="ctx-close" type="button" aria-label="Kontext schließen">${CLOSE}</button></div>
    <p class="c-sub">Diese Stücke gehören nicht in die Chronologie und haben keine Stelle im Video.</p>
    <ol class="c-list" id="c-list">
${ctxItems}
    </ol>
  </aside>
</div>

<dialog id="lb" aria-labelledby="lb-h">
  <div class="d-head"><h2 id="lb-h"></h2><button class="btn icon" type="button" data-close aria-label="Schließen">${CLOSE}</button></div>
  <figure class="d-body" style="margin:0"><div class="big" id="lb-img"></div><figcaption id="lb-cap"></figcaption></figure>
</dialog>

<dialog id="ton" class="wiz" data-at="1" aria-labelledby="ton-h">
  <div class="wiz-head">
    <div class="row"><h2 id="ton-h">Erweiterte Tonspurkontrolle</h2><button class="btn icon" type="button" data-close aria-label="Schließen">${CLOSE}</button></div>
    <ol class="steps" id="ton-steps"><li>Worum es geht</li><li>Video freigeben</li><li>Einzelspuren hören</li></ol>
  </div>

  <div class="wiz-body" data-step="1">
    <p class="lead">Zu hören ist die Mischung aller Geräte. Im Montagevideo liegt dahinter für jedes Gerät eine eigene Tonspur.</p>
    <ul class="gains">
      <li style="--k:var(--k-audio)"><span class="g-ic">${svg(ICON.audio!)}</span><p><b>Jedes Gerät einzeln hören</b><span>Etwa das Handy, wenn eine Stelle im Rekorder untergeht.</span></p></li>
      <li><span class="g-ic num">S·M</span><p><b>Stumm und solo schalten</b><span>An jeder Gerätespur der Zeitleiste: S nur diese Spur, M stumm.</span></p></li>
      <li style="--k:var(--k-video)"><span class="g-ic">${svg("M2 12.5h12M3.5 10V6.5M6.5 10V4M9.5 10V7.5M12.5 10V5")}</span><p><b>Sehen, welches Gerät gerade zu hören ist</b><span>Stumme Spuren sind in der Zeitleiste grau und durchgestrichen.</span></p></li>
    </ul>
    <div class="why">
      <p><b>Warum ein Extra-Schritt?</b> Chrome und Firefox spielen aus einer Videodatei von sich aus nur die erste Tonspur, die Mischung. Für die übrigen muss der Browser die Datei selbst lesen dürfen, und das erlaubt er nur nach einer ausdrücklichen Freigabe.</p>
      <p class="privacy"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 7.5h8a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1ZM5.5 7.5V5.2a2.5 2.5 0 0 1 5 0v2.3"/></svg><span><b>Nichts verlässt diesen Rechner.</b> Diese Seite hat keinen Netzzugang. Das Video wird nur hier im Browser gelesen, nicht kopiert und nicht hochgeladen.</span></p>
    </div>
    <p class="wiz-err" id="ton-unsupported" hidden>${svg("M8 2.5 14 13H2ZM8 6.5v3M8 11.3h.01")}<span>Dieser Browser kann Tonspuren nicht einzeln abspielen. Es bleibt bei der Mischung. Aktuelle Fassungen von Chrome, Edge, Firefox und Safari können es.</span></p>
  </div>
  <div class="wiz-foot" data-step="1"><button class="btn" type="button" data-close>Nicht jetzt</button><span class="grow"></span><button class="btn fill" type="button" id="ton-next">Weiter</button></div>

  <div class="wiz-body" data-step="2">
    <p class="lead">Das Montagevideo liegt im selben Ordner wie diese Datei.</p>
    <div class="drop" id="ton-drop">
      <svg class="file" viewBox="150 50 710 930" aria-hidden="true"><path d="M232 64H640L840 264V900a60 60 0 0 1-60 60H232a60 60 0 0 1-60-60V124a60 60 0 0 1 60-60Z" fill="#fdf6e9" stroke="#c9a77d" stroke-width="14"/><path d="M172 808h668v92a60 60 0 0 1-60 60H232a60 60 0 0 1-60-60Z" fill="#3a281d"/><path d="M172 808h200v152H232a60 60 0 0 1-60-60Z" fill="#a4441f"/><path d="M640 64V214a50 50 0 0 0 50 50H840Z" fill="#e3c9a8" stroke="#c9a77d" stroke-width="14" stroke-linejoin="round"/><path d="M420 400v250l210-125Z" fill="#3a281d" stroke="#3a281d" stroke-width="30" stroke-linejoin="round"/></svg>
      <code>${esc(opts.mediaFileName)}</code>
      <span>hierher ziehen</span>
      <span class="or">oder</span>
      <button class="btn fill" type="button" id="ton-pick">Video freigeben …</button>
    </div>
    <div class="wiz-err" id="ton-err" role="alert" hidden>
      ${svg("M8 2.5 14 13H2ZM8 6.5v3M8 11.3h.01")}
      <div><b id="ton-err-h">Das ist ein anderes Video.</b> Es bleibt bei der Mischung.
        <dl><dt>Gewählt</dt><dd class="num" id="ton-got"></dd><dt>Erwartet</dt><dd class="num" id="ton-exp"></dd></dl>
      </div>
    </div>
    <p class="hint" id="ton-wait" hidden>Das Video wird gelesen …</p>
    <p class="hint">Chrome und Edge merken sich die Freigabe und fragen beim nächsten Öffnen nur kurz nach. In Safari ist dieser Schritt nicht nötig.</p>
  </div>
  <div class="wiz-foot" data-step="2"><button class="btn" type="button" id="ton-prev">Zurück</button><span class="grow"></span></div>

  <div class="wiz-body" data-step="3">
    <div class="done-top"><span class="ok"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg></span><div><h3>Die Einzelspuren sind frei</h3><p class="hint" id="ton-found"></p></div></div>
    <dl class="howto">
      <dt><span class="ms solo" aria-hidden="true">S</span></dt><dd>Nur diese Spur hören. Mehrere S ergeben eine eigene Auswahl.</dd>
      <dt><span class="ms mute" aria-hidden="true">M</span></dt><dd>Diese Spur stumm schalten.</dd>
      <dt><kbd>1</kbd> … <kbd>9</kbd></dt><dd>Nur diese Tonspur, <kbd>0</kbd> oder „Alle hören“ bringt die Mischung zurück.</dd>
    </dl>
    <p class="hint">S und M stehen jetzt an den Gerätespuren unter dem Video. Bei anderem Tempo als 1× ist wieder die Mischung zu hören.</p>
  </div>
  <div class="wiz-foot" data-step="3"><span class="grow"></span><button class="btn fill" type="button" data-close>Fertig</button></div>
</dialog>

<dialog id="keys" aria-labelledby="keys-h">
  <div class="d-head"><h2 id="keys-h">Tastenkürzel</h2><button class="btn icon" type="button" data-close aria-label="Schließen">${CLOSE}</button></div>
  <div class="d-body"><dl class="keys">
    <dt><kbd>Leertaste</kbd> <kbd>K</kbd></dt><dd>Abspielen / anhalten</dd>
    <dt><kbd>←</kbd> <kbd>→</kbd> · <kbd>F8</kbd> <kbd>F9</kbd></dt><dd>5 Sekunden zurück / vor (wie in Feldspur)</dd>
    <dt><kbd>J</kbd> <kbd>L</kbd></dt><dd>30 Sekunden zurück / vor</dd>
    <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>zur Zeile davor / danach</dd>
    <dt><kbd>N</kbd> · <kbd>Umschalt</kbd>+<kbd>N</kbd></dt><dd>nächste / vorige Episode</dd>
    <dt><kbd>F7</kbd> · <kbd>Umschalt</kbd>+<kbd>F7</kbd></dt><dd>langsamer / schneller</dd>
    <dt><kbd>1</kbd> … <kbd>9</kbd> · <kbd>0</kbd></dt><dd>nur diese Tonspur hören · wieder alle (nach der Freigabe der Einzelspuren)</dd>
    <dt><kbd>M</kbd></dt><dd>Ton aus / an</dd>
    <dt><kbd>F</kbd></dt><dd>Vollbild an / aus (auch Doppelklick ins Video)</dd>
    <dt><kbd>T</kbd></dt><dd>Text läuft mit: an / aus</dd>
    <dt><kbd>+</kbd> <kbd>−</kbd> · Mausrad</dt><dd>Zeitleiste vergrößern / verkleinern; Umschalt+Mausrad verschiebt</dd>
    <dt><kbd>/</kbd> · <kbd>Strg</kbd>+<kbd>F</kbd></dt><dd>suchen; <kbd>Enter</kbd> nächster Treffer, <kbd>Umschalt</kbd>+<kbd>Enter</kbd> voriger</dd>
    ${ctxCount ? "<dt><kbd>C</kbd></dt><dd>Kontext zeigen / schließen</dd>" : ""}
    <dt><kbd>Esc</kbd></dt><dd>Suche leeren, Fenster schließen, Vollbild verlassen</dd>
  </dl></div>
</dialog>

<script type="application/json" id="feldspur-daten">${json}</script>
<script>
${viewerScript()}
</script>
</body>
</html>
`;
}
