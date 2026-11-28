/**
 * Angaben zum Datensatz und die gemeinsame Beschreibung einer Ausgabe (Issue #206, Gesamtkonzept #202).
 *
 * Forschende tragen die Angaben einmal fürs Projekt ein, ein Einsatz kann einzelne Felder überschreiben
 * (`DatasetInfo` in `packages/core/src/model.ts`). `mergeDataset` führt beide zusammen. `describeExport` macht daraus
 * mit den Kennwerten des Einsatzes und den Dateien der Ausgabe ein Datenobjekt, aus dem die LIESMICH (`readme.ts`) und
 * die Metadaten (`ro-crate.ts`) entstehen. Was die eine nennt, nennt so auch die andere.
 *
 * Feldspur bewertet hier nichts und setzt nichts voraus: Leere Felder bleiben leer. Nur Urheber*innen und Titel sind
 * aus den Einsatzdaten vorbelegt (Forschende an den Geräten, Titel und Datum des Einsatzes), weil RO-Crate einen Namen
 * braucht und die Forschenden ohnehin im Einsatztranskript stehen.
 */
// Nur Teile von core ohne Datenbank: Die Oberfläche liest die Felder und Vorschläge über `@feldspur/media/dataset`.
import type { Id, Person, ProjectStore, SourceKind } from "@feldspur/core";
import { DatasetInfo } from "@feldspur/core/model";
import { localToUtc } from "@feldspur/core/time";
import { DEFAULT_FORMAT, formatText, type MontageFormat } from "./layout.ts";
import type { SessionTranscript } from "./session-transcript.ts";

/** Dateiname der LIESMICH im Ausgabeordner. */
export const README_NAME = "LIESMICH.html";
/** Prüfsummenliste im Ordner (Issue #204). */
export const MANIFEST_NAME = "manifest-sha256.txt";
/** Metadaten nach RO-Crate 1.2 (Issue #206); der Name ist vom Standard vorgegeben. */
export const RO_CRATE_NAME = "ro-crate-metadata.json";

/** Die Felder der Angaben in der Reihenfolge, in der Übersicht, Einsatzdaten und LIESMICH sie zeigen. */
export const DATASET_FIELDS: readonly { key: keyof DatasetInfo; label: string }[] = [
  { key: "title", label: "Titel" },
  { key: "creators", label: "Urheber*innen" },
  { key: "contributors", label: "Mitwirkende" },
  { key: "description", label: "Beschreibung" },
  { key: "keywords", label: "Schlagworte" },
  { key: "license", label: "Lizenz" },
  { key: "access", label: "Zugang" },
  { key: "partOf", label: "Gehört zu" },
];

/** Angaben ohne Leerraum am Rand und ohne leere Felder. */
export function cleanDataset(d: DatasetInfo | null | undefined): DatasetInfo {
  const out: DatasetInfo = {};
  for (const { key } of DATASET_FIELDS) {
    const v = d?.[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

/**
 * Angaben als Zeilen für den Kopf des Einsatztranskripts und des Viewers: „Titel des Datensatzes“ (neben dem Titel des
 * Einsatzes), Personen und Schlagworte in einer Zeile, Absätze der Beschreibung mit Leerzeichen verbunden.
 */
export function datasetLines(d: DatasetInfo): [string, string][] {
  const clean = cleanDataset(d);
  return DATASET_FIELDS.flatMap(({ key, label }) => {
    const v = clean[key];
    if (!v) return [];
    const people = key === "creators" || key === "contributors";
    const text = people
      ? parsePeople(v)
          .map((p) => (p.orcid ? `${p.name} (ORCID ${p.orcid})` : p.name))
          .join("; ")
      : v.replace(/\s*\n\s*/g, " ");
    return [[key === "title" ? "Titel des Datensatzes" : label, text]];
  });
}

/** Schlüssel in `project_meta`, unter dem die Angaben des Projekts als JSON stehen. */
const PROJECT_KEY = "dataset";

/** Angaben zum Datensatz für das ganze Projekt; ohne (gültigen) Eintrag leer. */
export function projectDataset(store: ProjectStore): DatasetInfo {
  const raw = store.getMeta(PROJECT_KEY);
  try {
    return cleanDataset(DatasetInfo.parse(raw ? JSON.parse(raw) : {}));
  } catch {
    return {};
  }
}

/** Angaben fürs Projekt speichern (leere Felder fallen weg); gibt sie bereinigt zurück. */
export function setProjectDataset(store: ProjectStore, d: DatasetInfo): DatasetInfo {
  const clean = cleanDataset(DatasetInfo.parse(d ?? {}));
  store.setMeta(PROJECT_KEY, JSON.stringify(clean));
  return clean;
}

/** Angaben, die für die Ausgabe des Einsatzes `sessionId` gelten: Projekt, darüber der Einsatz. */
export function sessionDataset(store: ProjectStore, sessionId: Id): DatasetInfo {
  return mergeDataset(projectDataset(store), store.getSession(sessionId).dataset);
}

/** Angaben des Projekts, darüber die des Einsatzes: Ein Feld im Einsatz ersetzt das ganze Feld im Projekt. */
export function mergeDataset(project: DatasetInfo | null | undefined, session: DatasetInfo | null | undefined) {
  return { ...cleanDataset(project), ...cleanDataset(session) };
}

/** Eine Person aus den Angaben: Name, auf Wunsch mit ORCID iD (nur die 16 Ziffern, ohne Adresse). */
export interface DatasetPerson {
  name: string;
  orcid?: string;
}

const ORCID_RE = /(?:https?:\/\/orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i;

/** Personen je Zeile; eine ORCID iD irgendwo in der Zeile wird erkannt und aus dem Namen genommen. */
export function parsePeople(text: string | undefined): DatasetPerson[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const m = ORCID_RE.exec(line);
      const name = (m ? line.replace(m[0], "") : line)
        .replace(/[\s,;()[\]]+$/g, "")
        .replace(/^[\s,;]+/, "")
        .replace(/\(\s*\)/g, "")
        .trim();
      return m ? { name, orcid: m[1]!.toUpperCase() } : { name };
    })
    .filter((p) => p.name);
}

/**
 * Personen wieder als Text, wie `parsePeople` ihn liest: eine Person je Zeile, die ORCID iD nach einem Komma. Zeilen
 * ohne Namen fallen weg. Die Oberfläche führt Personen als Liste und speichert sie so.
 */
export function formatPeople(people: readonly DatasetPerson[]): string {
  return people
    .map((p) => ({ name: p.name.replace(/\s+/g, " ").trim(), orcid: p.orcid }))
    .filter((p) => p.name)
    .map((p) => (p.orcid ? `${p.name}, ${p.orcid}` : p.name))
    .join("\n");
}

/**
 * ORCID iD aus einer Eingabe in der üblichen Schreibweise (vier Blöcke, großes X): mit oder ohne Adresse, Leerzeichen
 * und Bindestriche. Null, wenn es nicht 16 Zeichen sind (15 Ziffern, dann Ziffer oder X).
 */
export function normalizeOrcid(text: string): string | null {
  const t = text
    .trim()
    .replace(/^(?:https?:\/\/)?orcid\.org\//i, "")
    .replace(/[\s\u2010-\u2015-]/g, "")
    .toUpperCase();
  return /^\d{15}[\dX]$/.test(t) ? t.match(/.{4}/g)!.join("-") : null;
}

/** Stimmt die Prüfziffer (das letzte Zeichen) einer ORCID iD? Rechnung nach ISO 7064, 11-2. */
export function orcidChecksumOk(orcid: string): boolean {
  const t = orcid.replace(/-/g, "").toUpperCase();
  if (!/^\d{15}[\dX]$/.test(t)) return false;
  let total = 0;
  for (const digit of t.slice(0, 15)) total = (total + Number(digit)) * 2;
  const check = (12 - (total % 11)) % 11;
  return t[15] === (check === 10 ? "X" : String(check));
}

/** Schlagworte, durch Komma oder Semikolon getrennt, ohne Doppelte. */
export function keywordList(text: string | undefined): string[] {
  return [
    ...new Set(
      (text ?? "")
        .split(/[,;\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
}

/** Bekannte Lizenzen: Kurzname (wie man ihn tippt) und ihre Adresse. Groß- und Kleinschreibung zählen nicht. */
const LICENSES: [RegExp, string][] = [
  [/^cc[\s-]*by[\s-]*4\.0$/i, "https://creativecommons.org/licenses/by/4.0/"],
  [/^cc[\s-]*by[\s-]*sa[\s-]*4\.0$/i, "https://creativecommons.org/licenses/by-sa/4.0/"],
  [/^cc[\s-]*by[\s-]*nc[\s-]*4\.0$/i, "https://creativecommons.org/licenses/by-nc/4.0/"],
  [/^cc[\s-]*by[\s-]*nc[\s-]*sa[\s-]*4\.0$/i, "https://creativecommons.org/licenses/by-nc-sa/4.0/"],
  [/^cc[\s-]*by[\s-]*nd[\s-]*4\.0$/i, "https://creativecommons.org/licenses/by-nd/4.0/"],
  [/^cc[\s-]*by[\s-]*nc[\s-]*nd[\s-]*4\.0$/i, "https://creativecommons.org/licenses/by-nc-nd/4.0/"],
  [/^cc0(?:[\s-]*1\.0)?$/i, "https://creativecommons.org/publicdomain/zero/1.0/"],
];

/** Vorschläge für das Feld „Lizenz“ (ohne Vorauswahl). */
export const LICENSE_SUGGESTIONS = [
  "CC BY 4.0",
  "CC BY-SA 4.0",
  "CC BY-NC 4.0",
  "CC BY-NC-SA 4.0",
  "CC BY-NC-ND 4.0",
  "CC0 1.0",
  "Alle Rechte vorbehalten",
];

/**
 * Vorschläge für das Feld „Zugang“, ohne Vorauswahl und mit dem Zurückhaltenden zuerst: Bei sensiblen Daten soll
 * nichts nach „offen“ klingen, solange niemand es so einträgt.
 */
export const ACCESS_SUGGESTIONS = [
  "Nur für das Projektteam",
  "Auf Anfrage bei den Urheber*innen",
  "Gesperrt bis …",
  "Offen zugänglich",
];

/** Adresse der Lizenz: eine eingetragene Adresse selbst oder die einer bekannten Lizenz; sonst null. */
export function licenseUrl(text: string | undefined): string | null {
  const t = (text ?? "").trim();
  if (/^https?:\/\/\S+$/.test(t)) return t;
  return LICENSES.find(([re]) => re.test(t))?.[1] ?? null;
}

/** Wozu eine Datei der Ausgabe dient, am Ende des Namens erkannt. Reihenfolge zählt: Besonderes vor Allgemeinem. */
const FILE_ROLE: [RegExp, string][] = [
  [/\.mp4$/, "Montagevideo: die Aufnahmen aller Geräte auf einer Zeitachse, mit Uhrzeit, Herkunft und Montage-ID"],
  [/^LIESMICH\.html$/, "LIESMICH: diese Datei"],
  [/\.html$/, "Viewer: Einsatztranskript und Montagevideo zusammen im Browser ansehen"],
  [/_Variablen\.xlsx$/, "Dokumentvariablen für MAXQDA: die Angaben zum Einsatz"],
  [/_Begleitprotokoll\.csv$/, "Begleitprotokoll: Herkunft, Prüfsumme und Zeitbeleg jeder Datei"],
  [
    /_Aenderungsprotokoll\.csv$/,
    "Änderungsprotokoll: jede Änderung an diesem Einsatz mit Zeit und den Werten vorher und nachher",
  ],
  [/^manifest-sha256\.txt$/, "Prüfsummenliste: SHA-256 jeder anderen Datei im Ordner, prüfbar mit sha256sum -c"],
  [
    /^ro-crate-metadata\.json$/,
    "Metadaten (RO-Crate): dieselbe Beschreibung maschinenlesbar, für Archive und Repositorien",
  ],
  [/^Originale\//, "Kopie einer Originaldatei, Kurzzeichen wie im Begleitprotokoll"],
  [
    /^[^/]+\.feldspur$/,
    "Projektdatei: Arbeitsstand in Feldspur zum Zeitpunkt der Ausgabe; enthält Pfade des Rechners, auf dem sie entstand",
  ],
  [/_Resolve\.fcpxml$/, "Schnittliste für DaVinci Resolve: dieselbe Montage ohne Einblendungen"],
  [/\.docx$/, "Einsatztranskript: Mitschrift, Tagebuch und Fotos in zeitlicher Folge, mit Zeitmarken zum Video"],
];

/** Wozu die Datei `name` dient; leer, wenn Feldspur sie nicht kennt. Am Video steht sein Format (Issue #250). */
export function fileRole(name: string, format: MontageFormat = DEFAULT_FORMAT): string {
  const text = FILE_ROLE.find(([re]) => re.test(name))?.[1] ?? "";
  return name.endsWith(".mp4") ? `${text} (${formatText(format)})` : text;
}

/** Eine Quelle, wie LIESMICH und Metadaten sie nennen: ohne Pfad auf dem eigenen Rechner. */
export interface DescribedSource {
  id: Id;
  label: string;
  kind: SourceKind;
  fileName: string;
  sha256: string;
  device: string | null;
  person: string | null;
  /** Beginn und Ende auf der Zeitachse als UTC (ISO 8601); null ohne Lage, Ende nur bei Strecken. */
  start: string | null;
  end: string | null;
  sizeBytes: number;
  /** Pfad der Kopie im Ausgabeordner (`Originale/…`, Issue #208); null, wenn das Original nicht mitkopiert ist. */
  copy: string | null;
}

/** Ein Gerät mit den Quellen, die von ihm stammen. */
export interface DescribedDevice {
  id: Id;
  label: string;
  person: string | null;
  sources: Id[];
}

/** Die gemeinsame Beschreibung einer Ausgabe: Angaben, Kennwerte des Einsatzes und Dateien im Ordner. */
export interface ExportDescription {
  /** Name des Datensatzes: der eingetragene Titel, sonst Einsatz und Datum. */
  title: string;
  /** Wurde der Titel eingetragen (im Projekt oder im Einsatz)? */
  titleEntered: boolean;
  /** Urheber*innen; ohne Eintrag die Forschenden an den Geräten. */
  creators: DatasetPerson[];
  creatorsEntered: boolean;
  contributors: DatasetPerson[];
  description: string | null;
  keywords: string[];
  license: { name: string; url: string | null } | null;
  access: string | null;
  partOf: string | null;
  session: { title: string; date: string; place: string; timeZone: string; montageId: string; modeLabel: string };
  /** Beginn und Ende der Montage als UTC (ISO 8601); null, wenn nichts auf der Zeitachse liegt. */
  start: string | null;
  end: string | null;
  devices: DescribedDevice[];
  sources: DescribedSource[];
  /** Dateien im Ordner mit ihrem Zweck, in der Reihenfolge des Schreibens. */
  files: { name: string; role: string }[];
  /** Die eingetragenen Angaben als Paare „Feld: Wert“ für die LIESMICH; Vorbelegtes steht nicht dabei. */
  entered: [label: string, value: string][];
}

/** Was `describeExport` außer dem Einsatztranskript braucht. */
export interface DescribeOptions {
  /** Angaben zum Datensatz, schon zusammengeführt (`mergeDataset`). */
  dataset?: DatasetInfo;
  /** Personen des Projekts, um Geräte ihren Forschenden zuzuordnen. */
  persons?: readonly Person[];
  /** Dateien der Ausgabe im Ordner, in der Reihenfolge des Schreibens. */
  files: string[];
  format?: MontageFormat;
  /** Kopien der Originale im Ordner je Quelle (Issue #208). */
  copies?: ReadonlyMap<Id, string>;
}

const germanDate = (iso: string) => iso.split("-").reverse().join(".");

/** Die Beschreibung einer Ausgabe: das eine Datenobjekt für LIESMICH und Metadaten. */
export function describeExport(transcript: SessionTranscript, opts: DescribeOptions): ExportDescription {
  const h = transcript.header;
  const { input, resolved } = transcript;
  const d = cleanDataset(opts.dataset);
  const tz = input.session.timeZone;
  const iso = (ms: number) => new Date(localToUtc(ms, tz)).toISOString().replace(/\.000Z$/, "Z");
  const persons = new Map((opts.persons ?? []).map((p) => [p.id, p.name]));
  const devices = new Map(input.devices.map((x) => [x.id, x]));
  const personOf = (deviceId: Id | null) => {
    const p = deviceId ? devices.get(deviceId)?.personId : null;
    return p ? (persons.get(p) ?? null) : null;
  };
  // Quellen, die in diese Ausgabe eingehen: auf der Zeitachse oder als Kontext, ohne Teile einer Seite.
  const inExport = new Set(h.sources);
  const sources: DescribedSource[] = input.sources
    // Mitkopierte Originale gehören dazu, auch Seiten einer Tagebuchseite oder Quellen ohne Lage.
    .filter((s) => inExport.has(s.label) || opts.copies?.has(s.id))
    .map((s) => {
      const p = resolved.placements.get(s.id);
      return {
        id: s.id,
        label: s.label,
        kind: s.kind,
        fileName: s.fileName,
        sha256: s.sha256,
        device: s.deviceId ? (devices.get(s.deviceId)?.label ?? null) : null,
        person: personOf(s.deviceId),
        start: p ? iso(p.startMs) : null,
        end: p && p.endMs !== p.startMs ? iso(p.endMs) : null,
        sizeBytes: s.sizeBytes,
        copy: opts.copies?.get(s.id) ?? null,
      };
    });
  const used = new Set(sources.map((s) => s.id));
  const described: DescribedDevice[] = input.devices
    .map((x) => ({
      id: x.id,
      label: x.label,
      person: personOf(x.id),
      sources: input.sources.filter((s) => s.deviceId === x.id && used.has(s.id)).map((s) => s.id),
    }))
    .filter((x) => x.sources.length);
  const segments = transcript.plan.segments;
  const creators = parsePeople(d.creators);
  const entered: [string, string][] = DATASET_FIELDS.flatMap(({ key, label }) => (d[key] ? [[label, d[key]]] : []));
  return {
    title: d.title ?? `${h.title} · ${germanDate(h.date)}`,
    titleEntered: !!d.title,
    creators: creators.length ? creators : h.researchers.map((name) => ({ name })),
    creatorsEntered: creators.length > 0,
    contributors: parsePeople(d.contributors),
    description: d.description ?? null,
    keywords: keywordList(d.keywords),
    license: d.license ? { name: d.license, url: licenseUrl(d.license) } : null,
    access: d.access ?? null,
    partOf: d.partOf ?? null,
    session: {
      title: h.title,
      date: h.date,
      place: h.place,
      timeZone: tz,
      montageId: h.montageId,
      modeLabel: h.modeLabel,
    },
    start: segments.length ? iso(segments[0]!.fromMs) : null,
    end: segments.length ? iso(segments.at(-1)!.toMs) : null,
    devices: described,
    sources,
    files: opts.files.map((name) => ({ name, role: fileRole(name, opts.format) })),
    entered,
  };
}
