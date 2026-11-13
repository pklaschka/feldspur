/**
 * Zugriff auf eine .feldspur-Projektdatei (eine SQLite-Datei).
 *
 * Läuft nur im Electron-Hauptprozess bzw. in Node, nie im Renderer.
 * Alle Eingaben werden mit den Zod-Schemas aus model.ts geprüft, bevor sie
 * gespeichert werden.
 */
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  AudioAnalysis,
  Device,
  DiaryEntry,
  FieldSession,
  Person,
  Source,
  SyncAnchor,
  TimeEvidence,
  TranscriptLine,
  type Id,
  type SourceKind,
} from "../model.ts";
import type { ResolveInput } from "../resolve.ts";
import { MIGRATIONS } from "./migrations.ts";
import * as schema from "./schema.ts";

export const FILE_FORMAT = "feldspur-project";
export const SCHEMA_VERSION = MIGRATIONS.length;

const LABEL_PREFIX: Record<SourceKind, { prefix: string; digits: number }> = {
  video: { prefix: "V", digits: 2 },
  audio: { prefix: "A", digits: 2 },
  photo: { prefix: "F", digits: 3 },
  diary: { prefix: "T", digits: 2 },
  note: { prefix: "N", digits: 2 },
  gps: { prefix: "G", digits: 2 },
  other: { prefix: "X", digits: 2 },
};

type In<T extends z.ZodType> = z.input<T>;
type WithOptionalId<T> = Omit<T, "id"> & { id?: Id };

export interface OpenOptions {
  /**
   * Pfad zu einer better_sqlite3.node für eine andere Laufzeit. Electron braucht
   * eine eigene Bauart (andere ABI) als Node, in dem die Tests laufen.
   */
  nativeBinding?: string;
}

export class ProjectStore {
  readonly db: BetterSQLite3Database<typeof schema>;
  private constructor(
    private readonly sqlite: Database.Database,
    readonly path: string,
  ) {
    this.db = drizzle(sqlite, { schema });
  }

  /** Neue Projektdatei anlegen. Schlägt fehl, wenn die Datei schon ein Projekt ist. */
  static create(path: string, opts: { name: string } & OpenOptions): ProjectStore {
    const store = ProjectStore.open(path, opts);
    if (store.getMeta("name") !== undefined) {
      store.close();
      throw new Error(`Dort liegt schon ein Feldspur-Projekt: ${path}`);
    }
    store.setMeta("name", opts.name);
    store.setMeta("created_at", new Date().toISOString());
    return store;
  }

  /** Projektdatei öffnen und bei Bedarf auf den aktuellen Stand migrieren. `:memory:` für Tests. */
  static open(path: string, opts: OpenOptions = {}): ProjectStore {
    const sqlite = new Database(path, opts.nativeBinding ? { nativeBinding: opts.nativeBinding } : {});
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const version = sqlite.pragma("user_version", { simple: true }) as number;
    if (version > SCHEMA_VERSION) {
      sqlite.close();
      throw new Error(
        `Die Projektdatei stammt aus einer neueren Feldspur-Version (Schema ${version}, unterstützt bis ${SCHEMA_VERSION}).`,
      );
    }
    sqlite.transaction(() => {
      for (let v = version; v < SCHEMA_VERSION; v++) sqlite.exec(MIGRATIONS[v]!);
      sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
    const store = new ProjectStore(sqlite, path);
    if (store.getMeta("format") === undefined) store.setMeta("format", FILE_FORMAT);
    return store;
  }

  close(): void {
    this.sqlite.close();
  }

  transaction<T>(fn: () => T): T {
    return this.sqlite.transaction(fn)();
  }

  getMeta(key: string): string | undefined {
    return this.db.select().from(schema.projectMeta).where(eq(schema.projectMeta.key, key)).get()?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .insert(schema.projectMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.projectMeta.key, set: { value } })
      .run();
  }

  // ── Einsätze ─────────────────────────────────────────────────────────────

  addSession(input: WithOptionalId<In<typeof FieldSession>>): FieldSession {
    const s = FieldSession.parse({ ...input, id: input.id ?? randomUUID() });
    this.db.insert(schema.sessions).values(s).run();
    return s;
  }

  listSessions(): FieldSession[] {
    return this.db
      .select()
      .from(schema.sessions)
      .orderBy(asc(schema.sessions.date))
      .all()
      .map((r) => FieldSession.parse(r));
  }

  getSession(id: Id): FieldSession {
    const r = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
    if (!r) throw new Error(`Einsatz nicht gefunden: ${id}`);
    return FieldSession.parse(r);
  }

  updateSession(id: Id, patch: Partial<Omit<FieldSession, "id">>): FieldSession {
    const next = FieldSession.parse({ ...this.getSession(id), ...patch, id });
    this.db.update(schema.sessions).set(next).where(eq(schema.sessions.id, id)).run();
    return next;
  }

  // ── Personen ─────────────────────────────────────────────────────────────

  addPerson(input: WithOptionalId<In<typeof Person>>): Person {
    const p = Person.parse({ ...input, id: input.id ?? randomUUID() });
    this.db.insert(schema.persons).values(p).run();
    return p;
  }

  listPersons(): Person[] {
    return this.db
      .select()
      .from(schema.persons)
      .all()
      .map((r) => Person.parse(r));
  }

  // ── Geräte ───────────────────────────────────────────────────────────────

  addDevice(input: WithOptionalId<In<typeof Device>>): Device {
    const d = Device.parse({ ...input, id: input.id ?? randomUUID() });
    this.transaction(() => {
      if (d.isReference) this.clearReference(d.sessionId);
      this.db.insert(schema.devices).values(d).run();
    });
    return d;
  }

  listDevices(sessionId: Id): Device[] {
    return this.db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.sessionId, sessionId))
      .all()
      .map((r) => Device.parse(r));
  }

  getDevice(id: Id): Device {
    const r = this.db.select().from(schema.devices).where(eq(schema.devices.id, id)).get();
    if (!r) throw new Error(`Gerät nicht gefunden: ${id}`);
    return Device.parse(r);
  }

  updateDevice(id: Id, patch: Partial<Omit<Device, "id" | "sessionId">>): Device {
    const next = Device.parse({ ...this.getDevice(id), ...patch });
    this.transaction(() => {
      if (next.isReference) this.clearReference(next.sessionId);
      this.db.update(schema.devices).set(next).where(eq(schema.devices.id, id)).run();
    });
    return next;
  }

  /** Dieses Gerät zur Referenzuhr machen. Alle anderen verlieren den Status. */
  setReferenceDevice(id: Id): Device {
    return this.updateDevice(id, {
      isReference: true,
      clockOffsetMs: 0,
      clockOffsetUncertaintyMs: 0,
      offsetBasis: "reference",
    });
  }

  private clearReference(sessionId: Id): void {
    this.db
      .update(schema.devices)
      .set({ isReference: false, offsetBasis: "unknown" })
      .where(and(eq(schema.devices.sessionId, sessionId), eq(schema.devices.isReference, true)))
      .run();
  }

  // ── Quellen ──────────────────────────────────────────────────────────────

  /** Nächstes freies Kurzzeichen im Einsatz: V-03, F-012 … */
  nextLabel(sessionId: Id, kind: SourceKind): string {
    const { prefix, digits } = LABEL_PREFIX[kind];
    const used = this.db
      .select({ label: schema.sources.label })
      .from(schema.sources)
      .where(eq(schema.sources.sessionId, sessionId))
      .all()
      .map((r) => r.label)
      .filter((l) => l.startsWith(`${prefix}-`))
      .map((l) => Number(l.slice(prefix.length + 1)))
      .filter(Number.isFinite);
    const n = (used.length ? Math.max(...used) : 0) + 1;
    return `${prefix}-${String(n).padStart(digits, "0")}`;
  }

  addSource(
    input: WithOptionalId<Omit<In<typeof Source>, "label" | "importedAt">> & { label?: string; importedAt?: string },
  ): Source {
    const s = Source.parse({
      ...input,
      id: input.id ?? randomUUID(),
      label: input.label ?? this.nextLabel(input.sessionId, input.kind),
      importedAt: input.importedAt ?? new Date().toISOString(),
    });
    this.db.insert(schema.sources).values(s).run();
    return s;
  }

  findSourceBySha(sessionId: Id, sha256: string): Source | undefined {
    const r = this.db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.sessionId, sessionId), eq(schema.sources.sha256, sha256)))
      .get();
    return r ? Source.parse(r) : undefined;
  }

  listSources(sessionId: Id): Source[] {
    return this.db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.sessionId, sessionId))
      .orderBy(asc(schema.sources.label))
      .all()
      .map((r) => Source.parse(r));
  }

  getSource(id: Id): Source {
    const r = this.db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
    if (!r) throw new Error(`Quelle nicht gefunden: ${id}`);
    return Source.parse(r);
  }

  updateSource(
    id: Id,
    patch: Partial<Pick<Source, "deviceId" | "kind" | "title" | "label" | "partOf" | "follows">>,
  ): Source {
    const r = this.db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
    if (!r) throw new Error(`Quelle nicht gefunden: ${id}`);
    const next = Source.parse({ ...r, ...patch });
    this.db.update(schema.sources).set(next).where(eq(schema.sources.id, id)).run();
    return next;
  }

  /**
   * Quelle aus dem Projekt nehmen (die Originaldatei bleibt unberührt). Zeitbelege, Anker und
   * Tonspur-Analyse gehen per Fremdschlüssel mit; Tagebuch-Rahmen auf dieser Seite werden entfernt,
   * Einträge ohne Rahmen gelöscht. Ein Gerät ohne Quellen verschwindet ebenfalls.
   */
  deleteSource(id: Id): void {
    const src = this.getSource(id);
    this.transaction(() => {
      for (const e of this.listDiaryEntries(src.sessionId)) {
        if (!e.regions.some((r) => r.sourceId === id)) continue;
        const regions = e.regions.filter((r) => r.sourceId !== id);
        if (regions.length) this.updateDiaryEntry(e.id, { regions });
        else this.deleteDiaryEntry(e.id);
      }
      this.db.delete(schema.sources).where(eq(schema.sources.id, id)).run();
      if (src.deviceId) this.deleteDeviceIfEmpty(src.deviceId);
    });
  }

  /** Gerät löschen, wenn ihm keine Quelle mehr gehört. Gibt zurück, ob es gelöscht wurde. */
  deleteDeviceIfEmpty(id: Id): boolean {
    const rest = this.db.select().from(schema.sources).where(eq(schema.sources.deviceId, id)).all();
    if (rest.length) return false;
    this.db.delete(schema.devices).where(eq(schema.devices.id, id)).run();
    return true;
  }

  // ── Zeitbelege ───────────────────────────────────────────────────────────

  addEvidence(input: WithOptionalId<In<typeof TimeEvidence>>): TimeEvidence {
    const e = TimeEvidence.parse({ ...input, id: input.id ?? randomUUID() });
    this.db.insert(schema.evidence).values(e).run();
    return e;
  }

  listEvidence(sessionId: Id): TimeEvidence[] {
    return this.db
      .select({ e: schema.evidence })
      .from(schema.evidence)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.evidence.sourceId))
      .where(eq(schema.sources.sessionId, sessionId))
      .all()
      .map((r) => TimeEvidence.parse(r.e));
  }

  getEvidence(id: Id): TimeEvidence {
    const row = this.db.select().from(schema.evidence).where(eq(schema.evidence.id, id)).get();
    if (!row) throw new Error(`Zeitbeleg ${id} nicht gefunden`);
    return TimeEvidence.parse(row);
  }

  setEvidenceEnabled(id: Id, enabled: boolean): void {
    this.db.update(schema.evidence).set({ enabled }).where(eq(schema.evidence.id, id)).run();
  }

  /** Uhrzeit eines Zeitbelegs verschieben (z. B. wenn das Einsatzdatum korrigiert wird). */
  updateEvidenceTime(id: Id, localMs: number): void {
    this.db.update(schema.evidence).set({ localMs }).where(eq(schema.evidence.id, id)).run();
  }

  deleteEvidence(id: Id): void {
    this.db.delete(schema.evidence).where(eq(schema.evidence.id, id)).run();
  }

  // ── Sync-Anker ───────────────────────────────────────────────────────────

  addAnchor(input: WithOptionalId<In<typeof SyncAnchor>>): SyncAnchor {
    const a = SyncAnchor.parse({ ...input, id: input.id ?? randomUUID() });
    this.db
      .insert(schema.anchors)
      .values({
        id: a.id,
        sessionId: a.sessionId,
        kind: a.kind,
        aSourceId: a.a.sourceId,
        aAtMediaMs: a.a.atMediaMs,
        bSourceId: a.b.sourceId,
        bAtMediaMs: a.b.atMediaMs,
        uncertaintyMs: a.uncertaintyMs,
        note: a.note,
        enabled: a.enabled,
        proposed: a.proposed,
        confidence: a.confidence,
      })
      .run();
    return a;
  }

  /** Alle unbestätigten Vorschläge eines Einsatzes durch neue ersetzen. */
  replaceProposedAnchors(sessionId: Id, proposals: WithOptionalId<In<typeof SyncAnchor>>[]): SyncAnchor[] {
    return this.transaction(() => {
      this.db
        .delete(schema.anchors)
        .where(and(eq(schema.anchors.sessionId, sessionId), eq(schema.anchors.proposed, true)))
        .run();
      return proposals.map((p) => this.addAnchor({ ...p, sessionId, proposed: true }));
    });
  }

  /** Vorschlag übernehmen: zählt ab jetzt für die Zeitbestimmung. */
  confirmAnchor(id: Id): void {
    this.db.update(schema.anchors).set({ proposed: false, enabled: true }).where(eq(schema.anchors.id, id)).run();
  }

  listAnchors(sessionId: Id): SyncAnchor[] {
    return this.db
      .select()
      .from(schema.anchors)
      .where(eq(schema.anchors.sessionId, sessionId))
      .all()
      .map((r) =>
        SyncAnchor.parse({
          id: r.id,
          sessionId: r.sessionId,
          kind: r.kind,
          a: { sourceId: r.aSourceId, atMediaMs: r.aAtMediaMs },
          b: { sourceId: r.bSourceId, atMediaMs: r.bAtMediaMs },
          uncertaintyMs: r.uncertaintyMs,
          note: r.note,
          enabled: r.enabled,
          proposed: r.proposed,
          confidence: r.confidence,
        }),
      );
  }

  getAnchor(id: Id): SyncAnchor {
    const r = this.db.select().from(schema.anchors).where(eq(schema.anchors.id, id)).get();
    if (!r) throw new Error(`Anker nicht gefunden: ${id}`);
    return this.listAnchors(r.sessionId).find((a) => a.id === id)!;
  }

  deleteAnchor(id: Id): void {
    this.db.delete(schema.anchors).where(eq(schema.anchors.id, id)).run();
  }

  // ── Tonspur-Analyse ──────────────────────────────────────────────────────

  saveAudioAnalysis(input: In<typeof AudioAnalysis>): AudioAnalysis {
    const a = AudioAnalysis.parse(input);
    const row = { ...a, envelope: Buffer.from(a.envelope) };
    this.db
      .insert(schema.audioAnalysis)
      .values(row)
      .onConflictDoUpdate({ target: schema.audioAnalysis.sourceId, set: row })
      .run();
    return a;
  }

  listAudioAnalyses(sessionId: Id): AudioAnalysis[] {
    return this.db
      .select({ a: schema.audioAnalysis })
      .from(schema.audioAnalysis)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.audioAnalysis.sourceId))
      .where(eq(schema.sources.sessionId, sessionId))
      .all()
      .map(({ a }) => AudioAnalysis.parse({ ...a, envelope: new Uint8Array(a.envelope) }));
  }

  // ── Tagebuch ─────────────────────────────────────────────────────────────

  addDiaryEntry(input: WithOptionalId<In<typeof DiaryEntry>>): DiaryEntry {
    const d = DiaryEntry.parse({ ...input, id: input.id ?? randomUUID() });
    this.db.insert(schema.diaryEntries).values(d).run();
    return d;
  }

  listDiaryEntries(sessionId: Id): DiaryEntry[] {
    return this.db
      .select()
      .from(schema.diaryEntries)
      .where(eq(schema.diaryEntries.sessionId, sessionId))
      .all()
      .map((r) => DiaryEntry.parse(r));
  }

  updateDiaryEntry(id: Id, patch: Partial<Omit<DiaryEntry, "id" | "sessionId">>): DiaryEntry {
    const r = this.db.select().from(schema.diaryEntries).where(eq(schema.diaryEntries.id, id)).get();
    if (!r) throw new Error(`Tagebucheintrag nicht gefunden: ${id}`);
    const next = DiaryEntry.parse({ ...r, ...patch });
    this.db.update(schema.diaryEntries).set(next).where(eq(schema.diaryEntries.id, id)).run();
    return next;
  }

  getDiaryEntry(id: Id): DiaryEntry {
    const r = this.db.select().from(schema.diaryEntries).where(eq(schema.diaryEntries.id, id)).get();
    if (!r) throw new Error(`Tagebucheintrag nicht gefunden: ${id}`);
    return DiaryEntry.parse(r);
  }

  deleteDiaryEntry(id: Id): void {
    this.db.delete(schema.diaryEntries).where(eq(schema.diaryEntries.id, id)).run();
  }

  // ── Mitschrift ───────────────────────────────────────────────────────────

  addTranscriptLine(input: WithOptionalId<In<typeof TranscriptLine>>): TranscriptLine {
    const l = TranscriptLine.parse({ ...input, id: input.id ?? randomUUID() });
    this.db.insert(schema.transcriptLines).values(l).run();
    return l;
  }

  /** Alle Zeilen der Quellen eines Einsatzes, je Quelle nach Stelle sortiert. */
  listTranscript(sessionId: Id): TranscriptLine[] {
    return this.db
      .select({ l: schema.transcriptLines })
      .from(schema.transcriptLines)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.transcriptLines.sourceId))
      .where(eq(schema.sources.sessionId, sessionId))
      .orderBy(asc(schema.transcriptLines.sourceId), asc(schema.transcriptLines.atMs))
      .all()
      .map(({ l }) => TranscriptLine.parse(l));
  }

  getTranscriptLine(id: Id): TranscriptLine {
    const r = this.db.select().from(schema.transcriptLines).where(eq(schema.transcriptLines.id, id)).get();
    if (!r) throw new Error(`Zeile nicht gefunden: ${id}`);
    return TranscriptLine.parse(r);
  }

  updateTranscriptLine(id: Id, patch: Partial<Omit<TranscriptLine, "id" | "sourceId">>): TranscriptLine {
    const next = TranscriptLine.parse({ ...this.getTranscriptLine(id), ...patch });
    this.db.update(schema.transcriptLines).set(next).where(eq(schema.transcriptLines.id, id)).run();
    return next;
  }

  deleteTranscriptLine(id: Id): void {
    this.db.delete(schema.transcriptLines).where(eq(schema.transcriptLines.id, id)).run();
  }

  // ── Alles für die Zeitbestimmung ────────────────────────────────────────

  loadResolveInput(sessionId: Id): ResolveInput {
    return {
      session: this.getSession(sessionId),
      devices: this.listDevices(sessionId),
      sources: this.listSources(sessionId),
      evidence: this.listEvidence(sessionId),
      anchors: this.listAnchors(sessionId),
      diaryEntries: this.listDiaryEntries(sessionId),
    };
  }
}
