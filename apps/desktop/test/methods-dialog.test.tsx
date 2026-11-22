// @vitest-environment happy-dom
import type { MethodsSessionSummary } from "@feldspur/media";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { FeldspurApi } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = {
  video: true,
  resolve: false,
  mixAudio: true,
  realtime: true,
  deviceTracks: true,
  viewer: true,
  readme: true,
};

/** Erfundener Einsatz mit einem Video; `n` unterscheidet Tag, Titel und Montage-ID. */
const einsatz = (n: number, exported: MethodsSessionSummary["exported"] = "current"): MethodsSessionSummary => ({
  sessionId: `s${n}`,
  title: `Testmarkt ${n}`,
  date: `2026-09-1${3 + n}`,
  material: [
    { kind: "video", device: "Kamera", files: n, durationMs: 60_000, basis: { metadata: n }, correctionsMs: [] },
  ],
  output: {
    base: `Feldtag_${n}`,
    lines: 10 * n,
    context: 0,
    durationMs: 60_000,
    mode: "Echtzeit",
    montageId: `FS-AAA${n}-BBB${n}-CCC${n}`,
    montageVideoId: `FS-AAA${n}-BBB${n}`,
    video: true,
  },
  exported,
  exportedAt: exported === "none" ? null : "2026-09-20T08:00:00.000Z",
});

let unmount = () => {};
afterEach(() => {
  act(() => unmount());
  document.body.innerHTML = "";
});

/** Dialog mit erfundener App-Schnittstelle öffnen. */
async function openDialog(sessions: MethodsSessionSummary[]) {
  const api = {
    methodsOverview: vi.fn(async () => ({
      sessions,
      citation: { version: "0.4.0", released: "2026-12-01", versionDoi: null },
    })),
    copyText: vi.fn(async (_text: string) => {}),
    copyTable: vi.fn(async (_html: string, _text: string) => {}),
    openCitationLink: vi.fn(async (_url: string) => {}),
  };
  (window as unknown as { feldspur: Partial<FeldspurApi> }).feldspur = api;
  vi.resetModules();
  const { MethodsDialog } = await import("../src/renderer/MethodsDialog.tsx");
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<MethodsDialog open onOpenChange={() => {}} options={OPTIONS} />));
  unmount = () => root.unmount();
  return api;
}
const text = (id: string) => document.querySelector(`[data-testid=${id}]`)?.textContent ?? "";
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(label));
const checkbox = (label: string) =>
  [...document.querySelectorAll("label")]
    .find((l) => l.textContent?.includes(label))
    ?.querySelector<HTMLInputElement>("input");

describe("Tabelle für den Methodenteil", () => {
  it("fasst alle Einsätze des Projekts zusammen und fragt mit den gewählten Einstellungen", async () => {
    const api = await openDialog([einsatz(2), einsatz(1)]);
    expect(api.methodsOverview).toHaveBeenCalledWith(OPTIONS);
    expect(text("methods-tables")).toContain("Eingang: Aufzeichnungen aus 2 Einsätzen (14.09.2026 bis 15.09.2026)");
    expect(text("methods-tables")).toContain("FS-AAA1-BBB1-CCC1");
    expect(text("methods-tables")).toContain("FS-AAA2-BBB2-CCC2");
    expect(text("methods-tables")).toContain("Feldspur, Version 0.4.0");
  });

  it("lässt einen abgewählten Einsatz aus Tabelle und Zwischenablage weg", async () => {
    // Angenommen: zwei Einsätze, beide gewählt
    const api = await openDialog([einsatz(1), einsatz(2)]);
    // Wenn: der zweite abgewählt und kopiert wird
    await act(async () => checkbox("Testmarkt 2")!.click());
    await act(async () => button("Tabellen kopieren")!.click());
    // Dann: steht nur der erste in Tabelle und Zwischenablage (als HTML und als Text)
    expect(text("methods-tables")).not.toContain("FS-AAA2");
    const [html, plain] = api.copyTable.mock.calls[0]!;
    expect(html).toContain("<table");
    expect(html).toContain("FS-AAA1-BBB1-CCC1");
    expect(html).not.toContain("FS-AAA2");
    expect(plain).toContain("Einsatz\tAusgabe\tDatei\tUmfang\tMontage-ID");
    expect(document.body.textContent).toContain("Als Tabelle kopiert");
  });

  it("kopiert auf Wunsch als Markdown", async () => {
    const api = await openDialog([einsatz(1)]);
    await act(async () => button("Als Markdown kopieren")!.click());
    expect(api.copyText.mock.calls[0]![0]).toContain("| Einsatz | Ausgabe | Datei | Umfang | Montage-ID |");
    expect(document.body.textContent).toContain("Als Markdown kopiert");
  });

  it("zeigt bei nur einem Einsatz keine Auswahl", async () => {
    await openDialog([einsatz(1)]);
    expect(document.querySelector("[data-testid=methods-sessions]")).toBeNull();
  });

  it.each`
    stand      | hinweis
    ${"stale"} | ${"14.09.2026 Testmarkt 1: seit der letzten Ausgabe geändert"}
    ${"none"}  | ${"14.09.2026 Testmarkt 1: noch nicht ausgegeben"}
  `("sagt, wenn ein Einsatz so nicht als Ausgabe vorliegt ($stand)", async ({ stand, hinweis }) => {
    await openDialog([einsatz(1, stand), einsatz(2)]);
    expect(text("methods-not-current")).toContain("Ein Einsatz liegt so noch nicht als Ausgabe vor.");
    expect(text("methods-not-current")).toContain(hinweis);
  });

  it("warnt nicht, wenn alle gewählten Einsätze aktuell ausgegeben sind", async () => {
    await openDialog([einsatz(1), einsatz(2)]);
    expect(document.querySelector("[data-testid=methods-not-current]")).toBeNull();
  });

  it("verweist auf den Mustertext im Handbuch", async () => {
    const api = await openDialog([einsatz(1)]);
    await act(async () => button("Mustertext im Handbuch")!.click());
    expect(api.openCitationLink).toHaveBeenCalledWith("https://purl.archive.org/feldspur#sec-methodenteil");
  });
});
