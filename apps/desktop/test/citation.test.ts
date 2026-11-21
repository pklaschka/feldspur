import { describe, expect, it } from "vite-plus/test";
import {
  ALL_VERSIONS_DOI,
  ZENODO_VERSIONS_URL,
  citationText,
  isCitationLink,
  pickVersionDoi,
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
  it("fragt ohne Anmeldung höchstens 25 Einträge ab, neueste zuerst (sonst lehnt Zenodo mit 400 ab)", () => {
    const url = new URL(ZENODO_VERSIONS_URL);
    expect(Number(url.searchParams.get("size"))).toBeLessThanOrEqual(25);
    expect(url.searchParams.get("sort")).toBe("newest");
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
    adresse                                      | erlaubt
    ${"https://doi.org/10.5281/zenodo.24289969"} | ${true}
    ${"https://zenodo.org/records/24310418"}     | ${true}
    ${"https://example.org/zenodo.org/"}         | ${false}
    ${"http://zenodo.org/records/1"}             | ${false}
    ${"file:///etc/passwd"}                      | ${false}
  `("der Dialog öffnet $adresse im Browser: $erlaubt", ({ adresse, erlaubt }) => {
    expect(isCitationLink(adresse)).toBe(erlaubt);
  });
});
