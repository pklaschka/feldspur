/**
 * Originaldateien prüfen und wiederfinden (Issues #70, #74).
 *
 * Feldspur verändert Originale nie und speichert beim Einsammeln Pfad, Größe und SHA-256. Hier wird nachgesehen,
 * ob die Datei noch da ist und noch dieselbe ist, und eine verschobene Datei über Größe und Prüfsumme wiedergefunden.
 * Ein Pfad wird nur übernommen, wenn die Prüfsumme stimmt: Ein gleicher Name allein genügt nie.
 *
 * Prüfergebnisse sind kein Forschungsdatum und kein Zeitbeleg: Sie werden nicht in die Projektdatei geschrieben.
 *
 * Einordnung: Aufgerufen wird alles hier vom Hauptprozess (`apps/desktop/src/main/originals.ts`). Die schnelle
 * Prüfung (`quickCheck`) liefert den Zustand für die Ansicht und den Schutz vor der Ausgabe, die volle
 * (`checkSources`) läuft, wenn Forschende die Originale prüfen oder suchen lassen
 * (`apps/desktop/src/renderer/Originals.tsx`). `findOriginals` und `verifyOriginal` dienen dem Neu-Verknüpfen,
 * `exportVerdict` entscheidet, was eine Ausgabe sperrt.
 */
import { stat, readdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Id, Source } from "@feldspur/core";
import { sha256File, type HashOptions } from "./hash.ts";
import { log } from "./log.ts";

/**
 * Zustand einer Originaldatei:
 * - ok: Größe und Prüfsumme wie beim Einsammeln
 * - unchecked: Datei da, Größe stimmt, Prüfsumme noch nicht gerechnet
 * - changed: Größe oder Prüfsumme anders als beim Einsammeln
 * - missing: unter dem gespeicherten Pfad liegt keine Datei
 * - unreadable: da, aber nicht lesbar (Rechte, Ordner statt Datei, Laufwerksfehler)
 */
export type FileState = "ok" | "unchecked" | "changed" | "missing" | "unreadable";

/** Prüfergebnis für eine Quelle (`Source`). */
export interface FileCheck {
  sourceId: Id;
  state: FileState;
  /** Kurzer Satz für die Oberfläche, z. B. „Größe anders: 12 MB statt 14 MB“. */
  detail: string;
}

/** Was eine Prüfung über eine Datei weiß; dient als Schlüssel für schon gerechnete Prüfsummen. */
export interface FileStamp {
  path: string;
  /** Größe in Bytes. */
  size: number;
  /** Änderungszeit laut Dateisystem. */
  mtimeMs: number;
}

const stampKey = (s: FileStamp) => `${s.path}|${s.size}|${s.mtimeMs}`;

/**
 * Gerechnete Prüfsummen, damit eine zweite Prüfung (oder der Export gleich nach der Prüfung) nicht erneut
 * stundenlange Videos liest. Gilt nur, solange Pfad, Größe und Änderungszeit gleich bleiben.
 */
export class HashCache {
  private readonly known = new Map<string, string>();
  get(stamp: FileStamp): string | undefined {
    return this.known.get(stampKey(stamp));
  }
  set(stamp: FileStamp, sha256: string): void {
    this.known.set(stampKey(stamp), sha256);
  }
  /** Bekannte Prüfsumme oder, falls noch keine da ist, die Datei jetzt lesen und das Ergebnis merken. */
  async hash(stamp: FileStamp, opts: HashOptions = {}): Promise<string> {
    const hit = this.get(stamp);
    if (hit) return hit;
    const h = await sha256File(stamp.path, opts);
    this.set(stamp, h);
    return h;
  }
}

const MB = 1024 * 1024;
function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * MB) return `${(n / MB).toFixed(1).replace(".", ",")} MB`;
  return `${(n / 1024 / MB).toFixed(2).replace(".", ",")} GB`;
}

type Stat = { ok: true; stamp: FileStamp } | { ok: false; state: "missing" | "unreadable"; detail: string };

function fromError(e: unknown): Stat {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, state: "missing", detail: "Datei nicht gefunden" };
  return { ok: false, state: "unreadable", detail: `Nicht lesbar (${code ?? (e as Error).message})` };
}

function fromStat(path: string, st: { isFile(): boolean; size: number; mtimeMs: number }): Stat {
  if (!st.isFile()) return { ok: false, state: "unreadable", detail: "Unter dem Pfad liegt keine Datei" };
  return { ok: true, stamp: { path, size: st.size, mtimeMs: st.mtimeMs } };
}

/** Synchron, nur für `quickCheck` (läuft beim Aufbau der Ansicht mit). Alles andere nimmt `statLater`. */
function statNow(path: string): Stat {
  try {
    return fromStat(path, statSync(path));
  } catch (e) {
    return fromError(e);
  }
}

async function statLater(path: string): Promise<Stat> {
  try {
    return fromStat(path, await stat(path));
  } catch (e) {
    return fromError(e);
  }
}

/**
 * Urteil aus dem, was bekannt ist, vom Billigen zum Teuren: erst da und lesbar, dann die Größe, zuletzt die
 * Prüfsumme. Ohne `hash` bleibt eine Datei mit passender Größe „unchecked“, nie „ok“.
 */
function judge(src: Source, st: Stat, hash: string | undefined): FileCheck {
  if (!st.ok) return { sourceId: src.id, state: st.state, detail: st.detail };
  if (st.stamp.size !== src.sizeBytes) {
    return {
      sourceId: src.id,
      state: "changed",
      detail: `Größe anders: ${size(st.stamp.size)} statt ${size(src.sizeBytes)}`,
    };
  }
  if (hash === undefined) return { sourceId: src.id, state: "unchecked", detail: "Datei da, Prüfsumme nicht geprüft" };
  if (hash !== src.sha256)
    return { sourceId: src.id, state: "changed", detail: "Prüfsumme anders als beim Einsammeln" };
  return { sourceId: src.id, state: "ok", detail: "Unverändert" };
}

/**
 * Schnelle Prüfung ohne Lesen der Datei: da, Größe gleich, und eine schon gerechnete Prüfsumme, falls bekannt.
 * Synchron, damit sie beim Aufbau der Ansicht mitlaufen kann.
 */
export function quickCheck(src: Source, cache?: HashCache): FileCheck {
  const st = statNow(src.originalPath);
  return judge(src, st, st.ok ? cache?.get(st.stamp) : undefined);
}

/** Vollständige Prüfung: Existenz, Größe und SHA-256. Liest jede Datei einmal (Cache hilft beim zweiten Mal). */
export async function checkSources(
  sources: Source[],
  opts: {
    cache?: HashCache;
    onProgress?: (done: number, total: number, fileName: string) => void;
    /**
     * Gelesene Bytes über alle Dateien (schon geprüfte zählen sofort), für einen gleichmäßigen Balken auch bei
     * wenigen großen Videos.
     */
    onBytes?: (done: number, total: number, fileName: string) => void;
    /** Bricht die Prüfung ab, auch mitten in einer Datei (wirft einen AbortError). */
    signal?: AbortSignal;
  } = {},
): Promise<FileCheck[]> {
  const cache = opts.cache ?? new HashCache();
  const out: FileCheck[] = [];
  const totalBytes = sources.reduce((n, s) => n + s.sizeBytes, 0);
  let before = 0;
  for (const [i, src] of sources.entries()) {
    opts.signal?.throwIfAborted();
    opts.onProgress?.(i, sources.length, src.fileName);
    opts.onBytes?.(before, totalBytes, src.fileName);
    const st = await statLater(src.originalPath);
    let hash: string | undefined;
    // Gelesen wird nur, wenn die Größe stimmt: Eine andere Größe ist schon ohne Prüfsumme „changed“.
    if (st.ok && st.stamp.size === src.sizeBytes) {
      try {
        hash = await cache.hash(st.stamp, {
          signal: opts.signal,
          onBytes: opts.onBytes && ((b) => opts.onBytes!(before + b, totalBytes, src.fileName)),
        });
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        const bad = fromError(e) as { state: "unreadable"; detail: string };
        log("prüfen", `${src.label} ${src.originalPath}: nicht lesbar (${bad.detail})`);
        out.push({ sourceId: src.id, ...bad });
        before += src.sizeBytes;
        continue;
      }
    }
    const verdict = judge(src, st, hash);
    log(
      "prüfen",
      `${src.label} ${src.originalPath}: ${verdict.state}${"detail" in verdict && verdict.detail ? ` (${verdict.detail})` : ""}`,
    );
    out.push(verdict);
    before += src.sizeBytes;
  }
  opts.onProgress?.(sources.length, sources.length, "");
  opts.onBytes?.(totalBytes, totalBytes, "");
  return out;
}

/** Zustände, bei denen die gespeicherte Datei nicht (mehr) das Original ist. */
export const NEEDS_RELINK: ReadonlySet<FileState> = new Set(["missing", "unreadable", "changed"]);

/** Ergebnis von `verifyOriginal`; `reason` ist ein Satz für die Oberfläche. */
export type VerifyResult = { ok: true; stamp: FileStamp } | { ok: false; reason: string };

/** Ist die Datei unter path genau das Original von src? Nur dann darf der Pfad übernommen werden. */
export async function verifyOriginal(src: Source, path: string, cache?: HashCache): Promise<VerifyResult> {
  const st = await statLater(path);
  if (!st.ok) return { ok: false, reason: st.detail };
  if (st.stamp.size !== src.sizeBytes) {
    return { ok: false, reason: `Größe passt nicht (${size(st.stamp.size)} statt ${size(src.sizeBytes)})` };
  }
  let hash: string;
  try {
    hash = await (cache ?? new HashCache()).hash(st.stamp);
  } catch (e) {
    return { ok: false, reason: (fromError(e) as { detail: string }).detail };
  }
  if (hash !== src.sha256) return { ok: false, reason: "Prüfsumme passt nicht: andere Datei mit gleicher Größe" };
  return { ok: true, stamp: st.stamp };
}

/** Ergebnis von `findOriginals`. */
export interface FindResult {
  /** Gefunden und per Prüfsumme bestätigt. */
  found: { sourceId: Id; path: string }[];
  /** Gleichnamige Dateien, die nicht passen (andere Größe oder Prüfsumme): nicht übernommen. */
  rejected: { sourceId: Id; path: string; reason: string }[];
  /** Durchsuchte Dateien. */
  scanned: number;
  /** Die Suche hat bei maxFiles aufgehört. */
  truncated: boolean;
}

export interface FindOptions {
  cache?: HashCache;
  /** Höchstens so viele Dateien ansehen (Schutz vor dem Durchsuchen ganzer Laufwerke). */
  maxFiles?: number;
  /** So viele Ebenen von Unterordnern (Standard 8). */
  maxDepth?: number;
  onProgress?: (scanned: number, phase: "suchen" | "prüfen", fileName: string) => void;
}

/**
 * Fehlende Originale in einem Ordner (mit Unterordnern) suchen. Kandidaten sind Dateien gleicher Größe, gleicher
 * Name zuerst; übernommen wird nur, was die Prüfsumme bestätigt. So findet sich auch eine umbenannte Datei, und
 * eine gleichnamige, aber andere Datei wird nie übernommen.
 */
export async function findOriginals(sources: Source[], dir: string, opts: FindOptions = {}): Promise<FindResult> {
  const cache = opts.cache ?? new HashCache();
  const maxFiles = opts.maxFiles ?? 50_000;
  const maxDepth = opts.maxDepth ?? 8;
  const wanted = new Set(sources.map((s) => s.sizeBytes));
  const names = new Set(sources.map((s) => s.fileName.toLowerCase()));
  const bySize = new Map<number, FileStamp[]>();
  const sameName: FileStamp[] = [];
  let scanned = 0;
  let truncated = false;

  // 1. Durchgang, ohne eine Datei zu lesen: Kandidaten gleicher Größe und gleichnamige Dateien sammeln.
  const walk = async (d: string, depth: number): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return; // nicht lesbarer Unterordner: weitersuchen
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // versteckte Ordner und Dateien (.git, .Trash, ._x)
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) await walk(p, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      if (++scanned > maxFiles) {
        truncated = true;
        return;
      }
      if (scanned % 500 === 0) opts.onProgress?.(scanned, "suchen", e.name);
      const isName = names.has(e.name.toLowerCase());
      const st = await statLater(p);
      if (!st.ok) continue;
      if (isName) sameName.push(st.stamp);
      if (!wanted.has(st.stamp.size)) continue;
      bySize.set(st.stamp.size, [...(bySize.get(st.stamp.size) ?? []), st.stamp]);
    }
  };
  await walk(dir, 0);
  if (truncated) scanned = maxFiles;

  // 2. Durchgang: je Quelle die Kandidaten per Prüfsumme prüfen. Eine gefundene Datei gilt nur für eine Quelle
  // (`taken`), damit zwei Quellen mit gleichem Inhalt nicht auf dieselbe Datei zeigen.
  const found: FindResult["found"] = [];
  const rejected: FindResult["rejected"] = [];
  const taken = new Set<string>();
  let checked = 0;
  for (const src of sources) {
    const lower = src.fileName.toLowerCase();
    const candidates = (bySize.get(src.sizeBytes) ?? [])
      .filter((c) => !taken.has(c.path))
      .toSorted(
        (a, b) => Number(basename(b.path).toLowerCase() === lower) - Number(basename(a.path).toLowerCase() === lower),
      );
    let hit: string | null = null;
    for (const c of candidates) {
      opts.onProgress?.(++checked, "prüfen", basename(c.path));
      let h: string;
      try {
        h = await cache.hash(c);
      } catch {
        continue;
      }
      if (h === src.sha256) {
        hit = c.path;
        break;
      }
    }
    if (hit) {
      taken.add(hit);
      log("originale", `${src.label} gefunden: ${hit}`);
      found.push({ sourceId: src.id, path: hit });
      continue;
    }
    // Gleichnamig, aber nicht das Original: melden, damit klar ist, warum nichts übernommen wurde.
    for (const c of sameName.filter((x) => basename(x.path).toLowerCase() === lower)) {
      let reason = `Größe passt nicht (${size(c.size)} statt ${size(src.sizeBytes)})`;
      if (c.size === src.sizeBytes) reason = "Prüfsumme passt nicht";
      log("originale", `${src.label} nicht übernommen: ${c.path} (${reason})`);
      rejected.push({ sourceId: src.id, path: c.path, reason });
    }
  }
  return { found, rejected, scanned, truncated };
}

/** Teilt die Prüfergebnisse für eine Ausgabe in Sperren und Warnungen (siehe Handbuch „Originaldateien“). */
export function exportVerdict(
  sources: Source[],
  checks: FileCheck[],
  opts: { video: boolean },
): { blocking: FileCheck[]; warnings: FileCheck[] } {
  const kind = new Map(sources.map((s) => [s.id, s.kind]));
  const blocking: FileCheck[] = [];
  const warnings: FileCheck[] = [];
  for (const c of checks) {
    if (c.state === "ok" || c.state === "unchecked") continue;
    const k = kind.get(c.sourceId);
    // Ohne die Datei bricht die Ausgabe ab: Bilder braucht das Einsatztranskript, Ton und Video das Montagevideo.
    const needed = k === "photo" || k === "diary" || (opts.video && (k === "audio" || k === "video"));
    if ((c.state === "missing" || c.state === "unreadable") && needed) blocking.push(c);
    else warnings.push(c);
  }
  return { blocking, warnings };
}
