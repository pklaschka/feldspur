/**
 * „Feldspur zitieren“: Zitat in den angebotenen Formaten und das Nachschlagen der DOI einer Version bei Zenodo
 * (`apps/desktop/src/shared/citation.ts`). Ohne Netz, die Antworten von Zenodo sind nachgestellt.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  ALL_VERSIONS_DOI,
  citationText,
  isCitationLink,
  pickVersionDoi,
  zenodoVersionUrl,
} from "../src/shared/citation.ts";

const v050 = { version: "0.5.0", released: "2026-12-03", doi: ALL_VERSIONS_DOI };

/** Erfundene Antwort im Aufbau der Zenodo-API (`/api/records?q=conceptrecid:…&all_versions=true`). */
const zenodo = {
  hits: {
    hits: [
      {
        id: 24310418,
        doi: "10.5281/zenodo.24310418",
        metadata: { version: "v0.5.0" },
        links: { self_html: "https://zenodo.org/records/24310418" },
      },
      { id: 24300001, doi: "10.5281/zenodo.24300001", metadata: { version: "v0.4.0" }, links: {} },
    ],
  },
};

describe("Zitat für Feldspur", () => {
  it("nennt in APA Autor*in, Jahr, Titel, Version und DOI", () => {
    expect(citationText("apa", v050)).toBe(
      "Klaschka, Z. N. (2026). Feldspur: Multimediale Feldaufzeichnungen auf einer gemeinsamen Zeitachse " +
        "zusammenführen (Version 0.5.0) [Software]. Zenodo. https://doi.org/10.5281/zenodo.24289969",
    );
  });

  it("liefert BibTeX mit Version, Lizenz und DOI", () => {
    const bib = citationText("bibtex", v050);
    expect(bib).toMatch(/^@software\{klaschka_feldspur_2026,/);
    for (const line of ["version   = {0.5.0}", "license   = {EUPL-1.2}", `doi       = {${ALL_VERSIONS_DOI}}`])
      expect(bib).toContain(line);
    expect(bib.endsWith("}")).toBe(true);
  });

  it("nennt als reine DOI die Adresse bei doi.org", () => {
    expect(citationText("doi", v050)).toBe(`https://doi.org/${ALL_VERSIONS_DOI}`);
  });
});

describe("DOI der Version bei Zenodo", () => {
  it("sucht gezielt nach der Version, mit und ohne „v“, in höchstens 25 Einträgen", () => {
    const url = new URL(zenodoVersionUrl("v0.3.0-rc.3"));
    expect(url.origin + url.pathname).toBe("https://zenodo.org/api/records");
    expect(url.searchParams.get("q")).toBe(
      `conceptrecid:24289969 AND (metadata.version:"0.3.0-rc.3" OR metadata.version:"v0.3.0-rc.3")`,
    );
    expect(Number(url.searchParams.get("size"))).toBeLessThanOrEqual(25);
    expect(url.searchParams.get("all_versions")).toBe("true");
  });
  it.each`
    version    | doi                          | seite
    ${"0.5.0"} | ${"10.5281/zenodo.24310418"} | ${"https://zenodo.org/records/24310418"}
    ${"0.4.0"} | ${"10.5281/zenodo.24300001"} | ${"https://zenodo.org/records/24300001"}
  `("findet für $version die DOI $doi, auch wenn Zenodo „v“ davorschreibt", ({ version, doi, seite }) => {
    expect(pickVersionDoi(zenodo, version)).toEqual({ doi, url: seite });
  });

  it("meldet nichts, solange die Version noch nicht auf Zenodo steht", () => {
    expect(pickVersionDoi(zenodo, "0.6.0")).toBeNull();
  });

  it("hält eine unerwartete Antwort für einen Fehler, nicht für eine fehlende Version", () => {
    expect(() => pickVersionDoi({ message: "rate limited" }, "0.5.0")).toThrow(/Unerwartete Antwort/);
  });

  it.each`
    adresse                                                 | erlaubt
    ${"https://doi.org/10.5281/zenodo.24289969"}            | ${true}
    ${"https://zenodo.org/records/24310418"}                | ${true}
    ${"https://purl.archive.org/feldspur#sec-methodenteil"} | ${true}
    ${"https://purl.archive.org/feldspur/pdf"}              | ${true}
    ${"https://purl.archive.org/feldspurig"}                | ${false}
    ${"https://purl.archive.org/anderes"}                   | ${false}
    ${"https://example.org/zenodo.org/"}                    | ${false}
    ${"http://zenodo.org/records/1"}                        | ${false}
    ${"file:///etc/passwd"}                                 | ${false}
  `("der Dialog öffnet $adresse im Browser: $erlaubt", ({ adresse, erlaubt }) => {
    expect(isCitationLink(adresse)).toBe(erlaubt);
  });
});
