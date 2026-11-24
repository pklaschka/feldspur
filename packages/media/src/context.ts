/**
 * Kontextstücke (Issue #108) für Anzeige und Ausgabe aufbereiten: Name, Fundstelle, Text, Bilder.
 * Die Reihenfolge und die Verweise rechnet die Zeitbestimmung (`ResolveResult.context`,
 * `packages/core/src/resolve.ts`).
 *
 * Einordnung: rein, ohne Projektdatei. Genutzt von `packages/media/src/session-transcript.ts` (Abschnitt „Kontext“
 * im Einsatztranskript, also Ausgeben) und von `apps/desktop/src/main/view.ts` (Kontext-Zeilen in der Ansicht des
 * Einsatzes). So zeigen App und Ausgabe dieselben Namen und Fundstellen.
 */
import {
  diaryPageLabel,
  formatClock,
  type ContextItem,
  type DiaryEntry,
  type DiaryMode,
  type Id,
  type ResolveInput,
  type ResolveResult,
  type Source,
  type SourceKind,
} from "@feldspur/core";
import { noteText } from "./note-text.ts";
import type { ImageRef } from "./session-transcript.ts";

/** Ein Kontextstück, fertig beschriftet. Es ist entweder ein Tagebucheintrag (`entry`) oder eine ganze Quelle. */
export interface ContextPiece {
  /** Stelle und Verweise aus der Zeitbestimmung. */
  item: ContextItem;
  /** Der Tagebucheintrag; null, wenn das Stück eine Quelle ist. */
  entry: DiaryEntry | null;
  /** Die Quelle (Foto, Notiz, …); null, wenn das Stück ein Tagebucheintrag ist. */
  source: Source | null;
  /** Art der Quelle; bei Tagebucheinträgen immer „diary“. */
  kind: SourceKind;
  /** Eigener Titel; leer = keiner. */
  title: string;
  /** Titel, sonst Fundstelle. */
  name: string;
  /** „Tagebuch T-01 · S. 3“, „Foto F-005, IMG_0007.jpg“, „Notiz N-01, plan.txt“, „Text ohne Scan“. */
  find: string;
  /** Gerät und Person wie bei den übrigen Zeilen („Tagebuch, Testperson A“). */
  who: string;
  /** Nur die Person; leer, wenn dem Gerät keine zugeordnet ist. */
  person: string;
  /** Wie viel Text dabei ist: Volltext, Kurzform oder nur der Scan. Quellen ohne Text gelten als „scan“. */
  mode: DiaryMode;
  /** Text ohne Vorsatz. */
  text: string;
  /** Freie Angabe, wann das Stück entstand („am Vorabend“); leer = keine. */
  made: string;
  /** Notierzeit „13:05“; null = keine. */
  notedAt: string | null;
  /** Uhrzeiten der datierten Einträge, die hierher verweisen („10:24“). */
  mentionedAt: string[];
  /** Bilder zum Stück: bei Fotos die Datei samt zugehörigen Teilen, bei Tagebucheinträgen die Ausschnitte. */
  images: ImageRef[];
}

/** Uhrzeit ohne Sekunden („13:05“). */
const hm = (ms: number) => formatClock(ms).slice(0, 5);

const KIND_WORD: Partial<Record<SourceKind, string>> = { photo: "Foto", note: "Notiz", gps: "GPS", other: "Datei" };

/** Alle Kontextstücke eines Einsatzes, aufbereitet, in Ausgabereihenfolge. */
export function contextPieces(input: ResolveInput, resolved: ResolveResult, persons: Map<Id, string>): ContextPiece[] {
  const src = new Map(input.sources.map((s) => [s.id, s]));
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const entries = new Map(input.diaryEntries.map((e) => [e.id, e]));
  const personOf = (s: Source | undefined) => {
    const d = s?.deviceId ? devices.get(s.deviceId) : undefined;
    return d?.personId ? (persons.get(d.personId) ?? "") : "";
  };
  const whoOf = (s: Source | undefined) => {
    const d = s?.deviceId ? devices.get(s.deviceId) : undefined;
    return [d?.label, personOf(s)].filter(Boolean).join(", ");
  };
  return resolved.context.map((item) => {
    const mentionedAt = item.mentionedBy.map((m) => hm(m.notedAtMs));
    if (item.sourceId) {
      const s = src.get(item.sourceId)!;
      const text = s.kind === "note" ? (noteText(s) ?? "") : "";
      const word = KIND_WORD[s.kind] ?? "Datei";
      const find = `${word} ${s.label}, ${s.fileName}`;
      const parts = input.sources.filter((x) => x.partOf === s.id);
      return {
        item,
        entry: null,
        source: s,
        kind: s.kind,
        title: s.title.trim(),
        name: s.title.trim() || find,
        find,
        who: whoOf(s),
        person: personOf(s),
        mode: text ? "full" : "scan",
        text,
        made: s.contextMade,
        notedAt: null,
        mentionedAt,
        images: s.kind === "photo" ? [s, ...parts].map((x) => ({ sourceId: x.id })) : [],
      };
    }
    // Sonst ein Tagebucheintrag. Gerät und Person kommen von der Seite, auf der sein erster Ausschnitt liegt.
    const e = entries.get(item.entryId!)!;
    const first = e.regions[0] ? src.get(e.regions[0].sourceId) : undefined;
    const page = first?.partOf ? src.get(first.partOf) : first;
    const find = first && e.regions[0] ? `Tagebuch ${diaryPageLabel(first, e.regions[0])}` : "Text ohne Scan";
    const text = e.mode === "full" ? e.fullText : e.mode === "short" ? e.shortText : "";
    return {
      item,
      entry: e,
      source: null,
      kind: "diary",
      title: e.title.trim(),
      name: e.title.trim() || find,
      find,
      who: whoOf(page),
      person: personOf(page),
      mode: e.mode,
      text,
      made: e.contextMade,
      notedAt: e.notedAtMs === null ? null : hm(e.notedAtMs),
      mentionedAt,
      images: e.regions.map((r) => ({ sourceId: r.sourceId, region: r })),
    };
  });
}

/**
 * Grauer Teil der Kopfzeile im Dokument, direkt hinter „Kontext · {Name}“: Fundstelle (nur wenn ein Titel davor
 * steht), Person, entstanden, notiert, erwähnt um. Beginnt mit „ · “ oder „ (“; leer, wenn es nichts gibt.
 */
export function contextHeadDetails(p: ContextPiece): string {
  const person = p.person ? ` (${p.person})` : "";
  const first = p.title ? ` · ${p.find}${person}` : person;
  const rest = [
    p.made ? `entstanden: ${p.made}` : "",
    p.notedAt ? `notiert ${p.notedAt}` : "",
    p.mentionedAt.length ? `erwähnt um ${p.mentionedAt.join(", ")}` : "",
  ].filter(Boolean);
  return first + rest.map((r) => ` · ${r}`).join("");
}

/** Text eines Kontextstücks im Dokument: „Kurzform: …“, „Volltext: …“, „nur Scan“ (bei Fotos ohne Text: leer). */
export function contextBody(p: ContextPiece): string {
  if (p.source) return p.text ? `Volltext: ${p.text}` : "";
  const modeLabel = p.mode === "full" ? "Volltext" : p.mode === "short" ? "Kurzform" : "nur Scan";
  return p.text ? `${modeLabel}: ${p.text}` : modeLabel;
}
