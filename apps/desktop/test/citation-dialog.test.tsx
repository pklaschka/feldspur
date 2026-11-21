// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { CitationInfo, CitationLookup, FeldspurApi } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const found = {
  doi: "10.5281/zenodo.24310418",
  url: "https://zenodo.org/records/24310418",
  checkedAt: "2026-12-04T10:00:00Z",
};

let unmount = () => {};
afterEach(() => {
  act(() => unmount());
  document.body.innerHTML = "";
});

/** Dialog mit erfundener App-Schnittstelle öffnen; `lookup` bestimmt die Antwort von Zenodo. */
async function openDialog(info: Partial<CitationInfo>, lookup: CitationLookup = { state: "found", versionDoi: found }) {
  const api = {
    citationInfo: vi.fn(async () => ({
      version: "0.5.0",
      released: "2026-12-03",
      prerelease: false,
      versionDoi: null,
      ...info,
    })),
    lookupCitationDoi: vi.fn(async () => lookup),
    cancelCitationLookup: vi.fn(async () => {}),
    copyText: vi.fn(async () => {}),
    openCitationLink: vi.fn(async () => {}),
  };
  (window as unknown as { feldspur: Partial<FeldspurApi> }).feldspur = api;
  vi.resetModules();
  const { CitationDialog } = await import("../src/renderer/CitationDialog.tsx");
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<CitationDialog open onOpenChange={() => {}} />));
  unmount = () => root.unmount();
  return api;
}
const notice = () => document.querySelector("[data-testid=citation-notice]")?.textContent ?? "";
const zitat = () => document.querySelector("[data-testid=citation-text]")?.textContent ?? "";
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(text));

describe("Feldspur zitieren", () => {
  it("fragt beim Öffnen nichts im Netz ab und zitiert mit der DOI für alle Versionen", async () => {
    const api = await openDialog({});
    expect(api.lookupCitationDoi).not.toHaveBeenCalled();
    expect(zitat()).toContain("(Version 0.5.0) [Software]. Zenodo. https://doi.org/10.5281/zenodo.24289969");
    expect(notice()).toContain("Diese DOI gilt für alle Versionen von Feldspur.");
    expect(notice()).toContain("Aus deinem Projekt wird nichts übertragen.");
  });

  it("setzt nach dem Nachschlagen die DOI von Version 0.5.0 ein", async () => {
    // Angenommen: der Dialog ist offen, Zenodo kennt Version 0.5.0
    const api = await openDialog({});
    // Wenn: „DOI bei Zenodo nachschlagen“ gewählt wird
    await act(async () => button("DOI bei Zenodo nachschlagen")!.click());
    // Dann: steht die DOI dieser Version im Zitat, und der Kasten sagt es
    expect(api.lookupCitationDoi).toHaveBeenCalledOnce();
    expect(zitat()).toContain("https://doi.org/10.5281/zenodo.24310418");
    expect(notice()).toContain("DOI von Version 0.5.0 eingesetzt.");
  });

  it("nutzt eine schon nachgeschlagene DOI, ohne Zenodo erneut zu fragen", async () => {
    const api = await openDialog({ versionDoi: found });
    expect(api.lookupCitationDoi).not.toHaveBeenCalled();
    expect(zitat()).toContain("10.5281/zenodo.24310418");
    expect(notice()).toContain("Feldspur merkt sie sich und fragt Zenodo nicht noch einmal.");
  });

  it.each`
    antwort      | ueberschrift
    ${"offline"} | ${"Zenodo ist nicht erreichbar."}
    ${"missing"} | ${"Version 0.5.0 steht noch nicht auf Zenodo."}
  `(
    "zeigt bei „$antwort“: $ueberschrift, und das Zitat behält die DOI für alle Versionen",
    async ({ antwort, ueberschrift }) => {
      await openDialog({}, { state: antwort });
      await act(async () => button("DOI bei Zenodo nachschlagen")!.click());
      expect(notice()).toContain(ueberschrift);
      expect(button("Erneut nachschlagen")).toBeDefined();
      expect(zitat()).toContain("10.5281/zenodo.24289969");
    },
  );

  it("bietet bei Vorabversionen kein Nachschlagen an", async () => {
    await openDialog({ version: "0.5.0-rc.1", prerelease: true });
    expect(notice()).toContain("Vorabversionen haben keine eigene DOI.");
    expect(button("DOI bei Zenodo nachschlagen")).toBeUndefined();
  });

  it("kopiert das Zitat im gewählten Format", async () => {
    // Angenommen: der Dialog ist offen
    const api = await openDialog({});
    // Wenn: BibTeX gewählt und kopiert wird
    await act(async () => button("BibTeX")!.click());
    await act(async () => button("Zitat kopieren")!.click());
    // Dann: liegt der BibTeX-Eintrag in der Zwischenablage, und der Dialog bestätigt es
    expect(api.copyText).toHaveBeenCalledWith(expect.stringMatching(/^@software\{/));
    expect(document.body.textContent).toContain("✓ Kopiert");
  });
});
