/**
 * Kontext (Issue #108): Quellen und Tagebucheinträge, die bewusst ohne Uhrzeit vor der Chronologie stehen.
 *
 * Kontext ist eine Rolle, kein eigener Datensatz: Umstellen ändert ein Feld, Zeitbelege, Notierzeit, Titel und
 * Verweise bleiben stehen. Die Reihenfolge wird als gewünschte Stelle (`contextOrder`) gespeichert; welche Nummer
 * ein Stück trägt, rechnet die Zeitbestimmung aus (siehe `contextItems` in @feldspur/core).
 */
import {
  contextItems,
  contextKey,
  diaryPageLabel,
  type ContextItem,
  type DiaryEntry,
  type Id,
  type ProjectStore,
  type Source,
} from "@feldspur/core";
import type { ContextDetails } from "../shared/api.ts";

/** Ton und Video gehen ins Montagevideo und brauchen dafür eine Uhrzeit. */
const AV = new Set(["audio", "video"]);

type Target = { kind: "source"; source: Source } | { kind: "entry"; entry: DiaryEntry };

/** „source:<id>“ oder „entry:<id>“ auflösen. Weitere Bilder einer Seite stehen für ihre Hauptquelle. */
function parseKey(s: ProjectStore, key: string): Target {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "source") {
    let source = s.getSource(id);
    if (source.partOf) source = s.getSource(source.partOf);
    return { kind: "source", source };
  }
  if (kind === "entry") return { kind: "entry", entry: s.getDiaryEntry(id) };
  throw new Error(`Unbekanntes Kontextstück: ${key}`);
}

function sessionOf(t: Target): Id {
  return t.kind === "source" ? t.source.sessionId : t.entry.sessionId;
}

/** Kontextstücke eines Einsatzes in ihrer jetzigen Reihenfolge (ohne Zeitbestimmung der Quellen). */
function currentOrder(s: ProjectStore, sessionId: Id): ContextItem[] {
  return contextItems(s.loadResolveInput(sessionId), new Map());
}

/** Gewünschte Stellen 1 … n in der angegebenen Reihenfolge speichern. */
function writeOrder(s: ProjectStore, keys: string[]): void {
  keys.forEach((key, i) => {
    const t = parseKey(s, key);
    if (t.kind === "source") {
      if (t.source.contextOrder !== i + 1) s.updateSource(t.source.id, { contextOrder: i + 1 });
    } else if (t.entry.contextOrder !== i + 1) s.updateDiaryEntry(t.entry.id, { contextOrder: i + 1 });
  });
}

/** Name eines Kontextstücks für Beschriftungen im Verlauf und in Meldungen: Titel, sonst Fundstelle. */
export function contextName(s: ProjectStore, key: string): string {
  const t = parseKey(s, key);
  if (t.kind === "source") return t.source.title.trim() || t.source.label;
  return t.entry.title.trim() || entryFind(s, t.entry);
}

/** Kurzzeichen bzw. Fundstelle für die Beschriftung beim Umstellen („F-005“, „T-01 · S. 3, Eintrag 2“). */
export function contextFind(s: ProjectStore, key: string): string {
  const t = parseKey(s, key);
  return t.kind === "source" ? t.source.label : entryFind(s, t.entry);
}

/** Fundstelle eines Eintrags: „T-01 · S. 3, Eintrag 2“ bzw. „Text ohne Scan“. */
function entryFind(s: ProjectStore, e: DiaryEntry): string {
  const first = e.regions[0];
  if (!first) return "Text ohne Scan";
  const src = s.getSource(first.sourceId);
  const main = src.partOf ? s.getSource(src.partOf) : src;
  const onPage = s
    .listDiaryEntries(e.sessionId)
    .filter((x) => x.regions.some((r) => r.sourceId === first.sourceId))
    .sort((a, b) => (a.regions[0]?.y ?? 0) - (b.regions[0]?.y ?? 0) || (a.regions[0]?.x ?? 0) - (b.regions[0]?.x ?? 0));
  const n = onPage.findIndex((x) => x.id === e.id) + 1;
  const page = diaryPageLabel(src.partOf ? main : src, first);
  return onPage.length > 1 ? `${page}, Eintrag ${n}` : page;
}

/**
 * Stück als Kontext führen (on) oder zurück in die Chronologie holen. Ein neues Kontextstück kommt ans Ende, ein
 * zurückkehrendes an seine alte Stelle, soweit es sie noch gibt.
 */
export function setContext(s: ProjectStore, key: string, on: boolean): Id {
  const t = parseKey(s, key);
  const sessionId = sessionOf(t);
  if (t.kind === "source" && t.source.kind === "diary") {
    if (on) return markPageContext(s, t.source.id);
    s.transaction(() => {
      for (const e of entriesOnPage(s, t.source))
        if (e.role === "context") s.updateDiaryEntry(e.id, { role: "timeline" });
      placeAt(s, sessionId, null, null);
    });
    return sessionId;
  }
  s.transaction(() => {
    if (t.kind === "source") {
      if (AV.has(t.source.kind)) throw new Error("Ton und Video können kein Kontext sein.");
      if ((t.source.role === "context") === on) return;
      s.updateSource(t.source.id, { role: on ? "context" : "timeline" });
    } else {
      if ((t.entry.role === "context") === on) return;
      if (!on && !t.entry.regions.length)
        throw new Error("Ein Text ohne Scan hat keine Seite und bleibt Kontext. Du kannst ihn löschen.");
      s.updateDiaryEntry(t.entry.id, { role: on ? "context" : "timeline" });
    }
    const old = t.kind === "source" ? t.source.contextOrder : t.entry.contextOrder;
    placeAt(s, sessionId, on ? canonical(t) : null, old);
  });
  return sessionId;
}

/**
 * Stellen lückenlos neu schreiben. `key` (gerade Kontext geworden) kommt an die Stelle `old`, die es früher hatte,
 * oder ans Ende; alle anderen behalten ihre Reihenfolge.
 */
function placeAt(s: ProjectStore, sessionId: Id, key: string | null, old: number | null): void {
  const keys = currentOrder(s, sessionId)
    .map((c) => c.key)
    .filter((k) => k !== key);
  if (key) keys.splice(old !== null ? Math.min(Math.max(old - 1, 0), keys.length) : keys.length, 0, key);
  writeOrder(s, keys);
}

function entriesOnPage(s: ProjectStore, page: Source): DiaryEntry[] {
  const parts = new Set([
    page.id,
    ...s
      .listSources(page.sessionId)
      .filter((x) => x.partOf === page.id)
      .map((x) => x.id),
  ]);
  return s.listDiaryEntries(page.sessionId).filter((e) => e.regions.some((r) => parts.has(r.sourceId)));
}

/**
 * Ganze Tagebuchseite als Kontext: Ohne Einträge entsteht einer über die ganze Seite (wie bei der Randnotiz),
 * Einträge ohne Uhrzeit werden Kontext. Datierte Einträge bleiben, wo sie sind: Dann geht es nur über die Abtipp-Ansicht.
 */
function markPageContext(s: ProjectStore, sourceId: Id): Id {
  let page = s.getSource(sourceId);
  if (page.partOf) page = s.getSource(page.partOf);
  if (page.kind !== "diary") throw new Error("Keine Tagebuchseite");
  const entries = entriesOnPage(s, page);
  if (entries.some((e) => e.role === "timeline" && e.notedAtMs !== null))
    throw new Error(
      "Auf der Seite stehen datierte Einträge. Rahme in „Tagebuch abtippen“ nur das ein, was Kontext ist.",
    );
  s.transaction(() => {
    const n = currentOrder(s, page.sessionId).length;
    if (!entries.length)
      s.addDiaryEntry({
        sessionId: page.sessionId,
        regions: [{ sourceId: page.id }],
        notedAtMs: null,
        mode: "scan",
        role: "context",
        contextOrder: n + 1,
      });
    entries
      .filter((e) => e.role !== "context")
      .forEach((e, i) => s.updateDiaryEntry(e.id, { role: "context", contextOrder: n + 1 + i }));
    placeAt(s, page.sessionId, null, null);
  });
  return page.sessionId;
}

/** Titel und „Entstanden“ eines Kontextstücks ändern (auch, wenn es gerade in der Chronologie ruht). */
export function setContextDetails(s: ProjectStore, key: string, details: ContextDetails): Id {
  const t = parseKey(s, key);
  const patch: { title?: string; contextMade?: string } = {};
  if (details.title !== undefined) patch.title = details.title.trim();
  if (details.made !== undefined) patch.contextMade = details.made.trim();
  if (t.kind === "source") s.updateSource(t.source.id, patch);
  else s.updateDiaryEntry(t.entry.id, patch);
  return sessionOf(t);
}

/** Kontextstück an Stelle `position` (1 … n) schieben; die anderen rücken nach. */
export function moveContext(s: ProjectStore, key: string, position: number): Id {
  const t = parseKey(s, key);
  const sessionId = sessionOf(t);
  const keys = currentOrder(s, sessionId).map((c) => c.key);
  const from = keys.indexOf(canonical(t));
  if (from < 0) throw new Error("Das Stück ist gerade kein Kontext.");
  const to = Math.min(keys.length - 1, Math.max(0, Math.round(position) - 1));
  keys.splice(to, 0, ...keys.splice(from, 1));
  s.transaction(() => writeOrder(s, keys));
  return sessionId;
}

/** Stelle, an der ein Stück gerade steht (1 … n); 0 = kein Kontext. */
export function contextPosition(s: ProjectStore, key: string): number {
  const t = parseKey(s, key);
  return currentOrder(s, sessionOf(t)).findIndex((c) => c.key === canonical(t)) + 1;
}

function canonical(t: Target): string {
  return t.kind === "source" ? contextKey.source(t.source.id) : contextKey.entry(t.entry.id);
}

/** Einmalig nach Fundstelle ordnen: Tagebuch nach Seite und Lage, Fotos nach Kurzzeichen, Texte ohne Scan zuletzt. */
export function sortContextByPage(s: ProjectStore, sessionId: Id): Id {
  s.transaction(() => {
    for (const src of s.listSources(sessionId))
      if (src.contextOrder !== null) s.updateSource(src.id, { contextOrder: null });
    for (const e of s.listDiaryEntries(sessionId))
      if (e.contextOrder !== null) s.updateDiaryEntry(e.id, { contextOrder: null });
    placeAt(s, sessionId, null, null);
  });
  return sessionId;
}

/** Verweise eines Tagebucheintrags auf Kontextstücke setzen (ersetzt alle bisherigen). */
export function setEntryRefs(s: ProjectStore, entryId: Id, refs: string[]): Id {
  const e = s.getDiaryEntry(entryId);
  const clean = [...new Set(refs)].filter((k) => k !== contextKey.entry(entryId));
  for (const k of clean) {
    const t = parseKey(s, k);
    if (sessionOf(t) !== e.sessionId) throw new Error("Das Kontextstück gehört zu einem anderen Einsatz.");
  }
  s.updateDiaryEntry(entryId, { contextRefs: clean });
  return e.sessionId;
}

/** Neues Kontextstück als reiner Text, ohne Scan (z. B. eine abends getippte Zusammenfassung). */
export function createContextText(s: ProjectStore, sessionId: Id, input: { title: string; text: string }): Id {
  s.getSession(sessionId);
  let id = "";
  s.transaction(() => {
    id = s.addDiaryEntry({
      sessionId,
      regions: [],
      notedAtMs: null,
      mode: "full",
      fullText: input.text,
      role: "context",
      title: input.title.trim(),
      contextOrder: currentOrder(s, sessionId).length + 1,
    }).id;
    placeAt(s, sessionId, null, null);
  });
  return id;
}

/**
 * Verweise auf ein Stück, das gelöscht wird, mit entfernen (sonst blieben sie als tote Schlüssel stehen).
 * Für Einträge und für Quellen samt der Einträge, die mit ihnen verschwinden.
 */
export function dropRefsTo(s: ProjectStore, sessionId: Id, keys: string[]): void {
  const gone = new Set(keys);
  for (const e of s.listDiaryEntries(sessionId)) {
    if (!e.contextRefs.some((k) => gone.has(k))) continue;
    s.updateDiaryEntry(e.id, { contextRefs: e.contextRefs.filter((k) => !gone.has(k)) });
  }
}
