/**
 * Metadaten der Ausgabe als RO-Crate 1.2 (`ro-crate-metadata.json`, Issue #206): dieselbe Beschreibung wie in der
 * LIESMICH, maschinenlesbar für Archive und Repositorien.
 *
 * Das Profil ist bewusst klein und im Handbuch beschrieben (Abschnitt „Metadaten (RO-Crate)“, `PROFILE_URL`):
 * - Der Ordner ist der Datensatz (`Dataset`) mit den Angaben der Forschenden, Zeitraum, Ort und Montage-ID.
 * - Jede Datei der Ausgabe ist ein `File` mit Zweck, Format und Größe.
 * - Jede Quelle ist ein `File` mit eigener Kennung `#quelle-…`: Sie liegt nicht im Ordner, trägt aber Dateiname,
 *   Kurzzeichen und SHA-256, damit sich das Original wiederfinden und prüfen lässt. Pfade des eigenen Rechners stehen
 *   nicht darin.
 * - Je Gerät eine Aufnahme (`CreateAction`): welches Gerät (`IndividualProduct`), wer (`Person`), wann, welche Quellen.
 * - Eine Ausgabe (`CreateAction`) mit Feldspur (`SoftwareApplication`): aus welchen Quellen welche Dateien wurden.
 *
 * Einordnung: `exportSession` (`export.ts`) schreibt die Datei nach der LIESMICH und vor der Prüfsummenliste; die
 * Beschreibung kommt aus `describeExport` (`dataset.ts`).
 */
import type { ExportDescription } from "./dataset.ts";

/** Adresse des Profils: der Abschnitt im Handbuch, der es beschreibt (dauerhafte Adresse). */
export const PROFILE_URL = "https://purl.archive.org/feldspur#sec-ro-crate";
/** Fassung des Profils; steigt, wenn sich ändert, was Feldspur hineinschreibt. */
export const PROFILE_VERSION = "1.0";

/** Was die Metadaten außer der Beschreibung brauchen. */
export interface RoCrateOptions {
  /** Tag der Ausgabe als ISO 8601 („2026-11-27T20:15:00Z“); Pflichtangabe `datePublished` in RO-Crate. */
  exportedAt: string;
  /** Größe jeder Datei im Ordner in Bytes, soweit sie schon geschrieben ist. */
  sizes: ReadonlyMap<string, number>;
  /** Feldspur mit Version und Adresse (DOI dieser Version oder aller Versionen). */
  software?: { version: string; url: string };
}

type Node = Record<string, unknown> & { "@id": string };
const ref = (id: string) => ({ "@id": id });

/** Dateiformat nach der Endung (IANA-Medientyp). */
const MEDIA_TYPE: [RegExp, string][] = [
  [/\.mp4$/i, "video/mp4"],
  [/\.html$/i, "text/html"],
  [/\.docx$/i, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [/\.xlsx$/i, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [/\.csv$/i, "text/csv"],
  [/\.txt$/i, "text/plain"],
  [/\.json$/i, "application/json"],
  [/\.fcpxml$/i, "application/xml"],
  [/\.(jpe?g)$/i, "image/jpeg"],
  [/\.png$/i, "image/png"],
  [/\.heic$/i, "image/heic"],
  [/\.pdf$/i, "application/pdf"],
  [/\.(m4a|aac)$/i, "audio/mp4"],
  [/\.mp3$/i, "audio/mpeg"],
  [/\.wav$/i, "audio/wav"],
  [/\.mov$/i, "video/quicktime"],
  [/\.gpx$/i, "application/gpx+xml"],
  [/\.md$/i, "text/markdown"],
];
const mediaType = (name: string) => MEDIA_TYPE.find(([re]) => re.test(name))?.[1];

/** Art der Quelle in Worten, wie im Handbuch. */
const KIND_TEXT: Record<string, string> = {
  video: "Video",
  audio: "Tonaufnahme",
  photo: "Foto",
  diary: "Tagebuchseite",
  note: "Notiz",
  gps: "Wegaufzeichnung",
  other: "Datei",
};

/** Kennung im Graphen aus einem Text: Kleinbuchstaben, Ziffern und Bindestriche. */
function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "x"
  );
}

/** Die Metadaten als JSON-Text (zwei Leerzeichen Einrückung, Zeilenende am Schluss). */
export function roCrateJson(d: ExportDescription, opts: RoCrateOptions): string {
  const graph: Node[] = [];
  const ids = new Set<string>();
  /** Einen Knoten anhängen; gleiche Kennung nur einmal (etwa dieselbe Person als Urheberin und am Gerät). */
  const add = (n: Node) => {
    if (ids.has(n["@id"])) return ref(n["@id"]);
    ids.add(n["@id"]);
    graph.push(n);
    return ref(n["@id"]);
  };
  const person = (p: { name: string; orcid?: string }) =>
    add({
      "@id": p.orcid ? `https://orcid.org/${p.orcid}` : `#person-${slug(p.name)}`,
      "@type": "Person",
      name: p.name,
    });

  graph.push({
    "@id": "ro-crate-metadata.json",
    "@type": "CreativeWork",
    conformsTo: ref("https://w3id.org/ro/crate/1.2"),
    about: ref("./"),
  });
  const root: Node = { "@id": "./", "@type": "Dataset" };
  graph.push(root);
  add({ "@id": PROFILE_URL, "@type": ["CreativeWork", "Profile"], name: "Feldspur-Ausgabe", version: PROFILE_VERSION });

  const s = d.session;
  root.name = d.title;
  if (d.description) root.description = d.description;
  root.datePublished = opts.exportedAt;
  root.conformsTo = ref(PROFILE_URL);
  root.identifier = s.montageId;
  root.author = d.creators.map(person);
  if (d.contributors.length) root.contributor = d.contributors.map(person);
  if (d.keywords.length) root.keywords = d.keywords;
  if (d.license)
    root.license = add({
      "@id": d.license.url ?? "#lizenz",
      "@type": "CreativeWork",
      name: d.license.name,
    });
  if (d.access) root.conditionsOfAccess = d.access;
  if (d.partOf)
    root.isPartOf = /^https?:\/\/\S+$/.test(d.partOf)
      ? ref(d.partOf)
      : add({ "@id": "#gehoert-zu", "@type": "CreativeWork", name: d.partOf });
  if (d.start && d.end) root.temporalCoverage = `${d.start}/${d.end}`;
  if (s.place) root.contentLocation = add({ "@id": "#ort", "@type": "Place", name: s.place });
  root.about = add({
    "@id": "#einsatz",
    "@type": "Event",
    name: s.title,
    startDate: d.start ?? s.date,
    ...(d.end ? { endDate: d.end } : {}),
    ...(s.place ? { location: ref("#ort") } : {}),
  });

  // Dateien der Ausgabe (im Ordner) und Quellen (nicht im Ordner, mit eigener Kennung).
  const outputs = d.files.map((f) => {
    const size = opts.sizes.get(f.name);
    const type = mediaType(f.name);
    return add({
      "@id": encodeURI(f.name),
      "@type": "File",
      name: f.name,
      ...(f.role ? { description: f.role } : {}),
      ...(type ? { encodingFormat: type } : {}),
      ...(size !== undefined ? { contentSize: String(size) } : {}),
    });
  });
  const sourceRef = new Map(
    d.sources.map((x) => {
      const type = mediaType(x.fileName);
      return [
        x.id,
        add({
          "@id": `#quelle-${slug(x.label)}`,
          "@type": "File",
          name: x.fileName,
          identifier: x.label,
          description: `${KIND_TEXT[x.kind] ?? "Datei"} ${x.label}, Originaldatei (nicht in diesem Ordner)`,
          ...(type ? { encodingFormat: type } : {}),
          sha256: x.sha256,
          ...(x.start ? { dateCreated: x.start } : {}),
        }),
      ];
    }),
  );
  root.hasPart = [...outputs, ...sourceRef.values()];

  // Aufnahme je Gerät: Gerät, Person, Zeitraum und die Quellen, die es geliefert hat.
  for (const dev of d.devices) {
    const own = d.sources.filter((x) => dev.sources.includes(x.id));
    const starts = own.flatMap((x) => (x.start ? [x.start] : [])).sort();
    const ends = own.flatMap((x) => [x.end ?? x.start].filter((t): t is string => !!t)).sort();
    const device = add({ "@id": `#geraet-${slug(dev.label)}`, "@type": "IndividualProduct", name: dev.label });
    add({
      "@id": `#aufnahme-${slug(dev.label)}`,
      "@type": "CreateAction",
      name: `Aufnahme mit ${dev.label}`,
      instrument: device,
      ...(dev.person ? { agent: person({ name: dev.person }) } : {}),
      ...(starts.length ? { startTime: starts[0] } : {}),
      ...(ends.length ? { endTime: ends.at(-1) } : {}),
      result: dev.sources.map((id) => sourceRef.get(id)!).filter(Boolean),
    });
  }

  // Die Ausgabe selbst: aus den Quellen mit Feldspur die Dateien im Ordner.
  const software = add({
    "@id": opts.software?.url ?? "https://purl.archive.org/feldspur/repo",
    "@type": "SoftwareApplication",
    name: "Feldspur",
    ...(opts.software ? { version: opts.software.version } : {}),
  });
  add({
    "@id": "#ausgabe",
    "@type": "CreateAction",
    name: `Ausgabe mit Feldspur, Montage-ID ${s.montageId} (${s.modeLabel})`,
    instrument: software,
    endTime: opts.exportedAt,
    object: [...sourceRef.values()],
    result: outputs,
  });

  const crate = {
    "@context": ["https://w3id.org/ro/crate/1.2/context", { sha256: "https://w3id.org/ro/terms/workflow-run#sha256" }],
    "@graph": graph,
  };
  return JSON.stringify(crate, null, 2) + "\n";
}
