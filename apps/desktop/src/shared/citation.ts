/**
 * Zitierangaben für Feldspur selbst (Issue #163): Texte für den Dialog „Feldspur zitieren“ und das Auswerten der
 * Versionsliste von Zenodo. Ohne Electron, damit Hauptprozess, Oberfläche und Tests dieselben Angaben nutzen.
 *
 * Die DOI für alle Versionen und die Angaben zur Software stehen auch in CITATION.cff; Version und Erscheinungsdatum
 * kommen aus der gebauten App (der Release-Workflow setzt sie, siehe scripts/release.ts).
 */

/** DOI für alle Versionen (Concept-DOI bei Zenodo); führt immer zur neuesten Version. */
export const ALL_VERSIONS_DOI = "10.5281/zenodo.24289969";
/** Kennung desselben Eintrags in der Zenodo-API (`conceptrecid`). */
export const ZENODO_CONCEPT_ID = "24289969";
export const SOFTWARE_TITLE =
  "Feldspur: Multimediale Feldaufzeichnungen auf einer gemeinsamen Zeitachse zusammenführen";
export const SOFTWARE_LICENSE = "EUPL-1.2";
export const AUTHOR = { family: "Klaschka", given: "Zuri Nimca", initials: "Z. N." } as const;

export type CitationFormat = "apa" | "bibtex" | "doi";

export const FORMAT_LABEL: Record<CitationFormat, string> = { apa: "APA", bibtex: "BibTeX", doi: "Nur DOI" };

export const doiUrl = (doi: string) => `https://doi.org/${doi}`;

const bareVersion = (v: string) => v.trim().replace(/^v/i, "");

/**
 * Suche nach genau dieser Feldspur-Version in der öffentlichen Zenodo-API (ohne Token). Gesucht wird gezielt nach der
 * Versionsnummer (mit und ohne „v“), damit es nicht darauf ankommt, wie viele Versionen es schon gibt: Ohne Anmeldung
 * liefert Zenodo höchstens 25 Einträge je Seite (größere Seiten lehnt es mit 400 ab).
 */
export function zenodoVersionUrl(version: string): string {
  const bare = bareVersion(version).replace(/[^\w.+-]/g, "");
  const params = new URLSearchParams({
    q: `conceptrecid:${ZENODO_CONCEPT_ID} AND (metadata.version:"${bare}" OR metadata.version:"v${bare}")`,
    all_versions: "true",
    size: "25",
    sort: "newest",
  });
  return `https://zenodo.org/api/records?${params}`;
}

/** Ein Stück Zitattext; `italic` für den Titel (APA), `doi` für die farbig hervorgehobene DOI. */
export interface CitationPart {
  text: string;
  italic?: boolean;
  doi?: boolean;
}

export interface CitationInput {
  version: string;
  /** Erscheinungsdatum der Version, `YYYY-MM-DD`. */
  released: string;
  doi: string;
}

/** Das Zitat im gewünschten Format, in Stücken (für die Darstellung) und als Text (zum Kopieren). */
export function citationParts(format: CitationFormat, c: CitationInput): CitationPart[] {
  const year = c.released.slice(0, 4);
  const url = doiUrl(c.doi);
  if (format === "doi") return [{ text: url, doi: true }];
  if (format === "apa")
    return [
      { text: `${AUTHOR.family}, ${AUTHOR.initials} (${year}). ` },
      { text: SOFTWARE_TITLE, italic: true },
      { text: ` (Version ${c.version}) [Software]. Zenodo. ` },
      { text: url, doi: true },
    ];
  const key = `${AUTHOR.family.toLowerCase()}_feldspur_${year}`;
  return [
    {
      text: [
        `@software{${key},`,
        `  author    = {${AUTHOR.family}, ${AUTHOR.given}},`,
        `  title     = {{${SOFTWARE_TITLE}}},`,
        `  year      = {${year}},`,
        `  version   = {${c.version}},`,
        `  publisher = {Zenodo},`,
        `  license   = {${SOFTWARE_LICENSE}},`,
        `  doi       = {`,
      ].join("\n"),
    },
    { text: c.doi, doi: true },
    { text: `},\n  url       = {${url}}\n}` },
  ];
}

export function citationText(format: CitationFormat, c: CitationInput): string {
  return citationParts(format, c)
    .map((p) => p.text)
    .join("");
}

/** DOI einer Version auf Zenodo, wie Feldspur sie nachgeschlagen hat. */
export interface VersionDoi {
  doi: string;
  /** Seite der Version auf Zenodo. */
  url: string;
}

/**
 * Sucht in der Antwort der Zenodo-API den Eintrag der laufenden Version. Zenodo übernimmt die Version vom GitHub-Tag
 * („v0.3.0“), daher zählt ein führendes „v“ nicht. Liefert null, wenn die Version (noch) nicht dabei ist.
 */
export function pickVersionDoi(response: unknown, version: string): VersionDoi | null {
  const hits = (response as { hits?: { hits?: unknown } } | null)?.hits?.hits;
  if (!Array.isArray(hits)) throw new Error("Unerwartete Antwort von Zenodo");
  const want = bareVersion(version);
  for (const hit of hits as {
    doi?: unknown;
    id?: unknown;
    metadata?: { version?: unknown };
    links?: { self_html?: unknown };
  }[]) {
    if (typeof hit?.metadata?.version !== "string" || bareVersion(hit.metadata.version) !== want) continue;
    if (typeof hit.doi !== "string" || !/^10\.\d{4,}\/\S+$/.test(hit.doi)) continue;
    const page =
      typeof hit.links?.self_html === "string" && hit.links.self_html.startsWith("https://zenodo.org/")
        ? hit.links.self_html
        : `https://zenodo.org/records/${String(hit.id ?? "")}`;
    return { doi: hit.doi, url: page };
  }
  return null;
}

/** Nur diese Adressen dürfen die Dialoge im Browser öffnen: DOI, Zenodo und das Handbuch über seine feste Adresse. */
export function isCitationLink(url: string): boolean {
  return /^https:\/\/(doi\.org\/|zenodo\.org\/|purl\.archive\.org\/feldspur(?:[/#?]|$))/.test(url);
}
