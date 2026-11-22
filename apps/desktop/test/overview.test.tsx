// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { FeldspurApi, OverviewSession } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Erfundener Einsatz mit einem Video; `n` unterscheidet Tag, Titel und Montage-ID. */
const einsatz = (n: number, patch: Partial<OverviewSession> = {}): OverviewSession => ({
  sessionId: `s${n}`,
  title: `Testmarkt ${n}`,
  date: `2026-09-1${3 + n}`,
  place: "Marktplatz",
  sources: 3 * n,
  unsynced: 0,
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
  exported: "current",
  exportedAt: "2026-09-20T08:00:00.000Z",
  // Video 10:00 bis 10:01, Foto 10:30, Tagebuch 11:00 (Wanduhrzeit, gelesen als UTC)
  marks: [
    {
      kind: "video",
      fromMs: Date.parse(`2026-09-1${3 + n}T10:00:00Z`),
      toMs: Date.parse(`2026-09-1${3 + n}T10:01:00Z`),
    },
    {
      kind: "photo",
      fromMs: Date.parse(`2026-09-1${3 + n}T10:30:00Z`),
      toMs: Date.parse(`2026-09-1${3 + n}T10:30:00Z`),
    },
    {
      kind: "diary",
      fromMs: Date.parse(`2026-09-1${3 + n}T11:00:00Z`),
      toMs: Date.parse(`2026-09-1${3 + n}T11:00:00Z`),
    },
  ],
  ...patch,
});

let unmount = () => {};
afterEach(() => {
  act(() => unmount());
  document.body.innerHTML = "";
  localStorage.clear();
});

/** Übersicht mit erfundener App-Schnittstelle zeigen. */
async function openOverview(sessions: OverviewSession[]) {
  const api = {
    projectOverview: vi.fn(async () => ({
      sessions,
      citation: { version: "0.4.0", released: "2026-12-01", versionDoi: null },
    })),
    copyText: vi.fn(async (_text: string) => {}),
    copyTable: vi.fn(async (_html: string, _text: string) => {}),
    openCitationLink: vi.fn(async (_url: string) => {}),
    saveFieldCalendar: vi.fn(async (_days: unknown[]) => "/tmp/Rundgang_Feldkalender.svg"),
  };
  (window as unknown as { feldspur: Partial<FeldspurApi> }).feldspur = api;
  vi.resetModules();
  const { Overview } = await import("../src/renderer/Overview.tsx");
  const onOpen = vi.fn((_id: string, _step?: string, _atMs?: number) => {});
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<Overview name="Rundgang" onOpen={onOpen} />));
  unmount = () => root.unmount();
  return { api, onOpen };
}
const text = (id: string) => document.querySelector(`[data-testid=${id}]`)?.textContent ?? "";
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(label));
const checkbox = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label^="${label}"]`);
const days = () =>
  [
    ...document.querySelectorAll("[data-testid=overview-days] li:not([aria-hidden]):not([data-testid=overview-place])"),
  ].map((li) => li.textContent ?? "");

describe("Übersicht des Projekts", () => {
  it("nennt das Projekt, die Feldtage in zeitlicher Folge und fasst sie in den Kennwerten zusammen", async () => {
    await openOverview([einsatz(2), einsatz(1)]);
    expect(text("overview")).toContain("Rundgang");
    expect(text("overview")).toContain("2 Feldtage · 14.09.2026 bis 15.09.2026");
    expect(days().map((d) => d.slice(0, 11))).toEqual(["Testmarkt 1", "Testmarkt 2"]);
    expect(text("overview-tables")).toContain("Eingang: Aufzeichnungen aus 2 Einsätzen (14.09.2026 bis 15.09.2026)");
    expect(text("overview-tables")).toContain("FS-AAA1-BBB1-CCC1");
    expect(text("overview-tables")).toContain("FS-AAA2-BBB2-CCC2");
    expect(text("overview-tables")).toContain("Feldspur, Version 0.4.0");
  });

  it("zeigt je Feldtag gezählte Tatsachen und den Stand der Ausgabe", async () => {
    await openOverview([einsatz(1), einsatz(2, { unsynced: 2, exported: "stale" })]);
    expect(days()[0]).toContain("14.09.2026 · Marktplatz");
    expect(days()[0]).toContain("3 Quellen");
    expect(days()[0]).toContain("10 Zeilen");
    expect(days()[0]).toContain("Ausgabe aktuell");
    expect(days()[0]).not.toContain("ohne Abgleich");
    expect(days()[1]).toContain("2 Uhren ohne Abgleich");
    expect(days()[1]).toContain("Ausgabe veraltet");
  });

  it.each`
    stand        | wort                  | sprung
    ${"current"} | ${"Ausgabe aktuell"}  | ${false}
    ${"stale"}   | ${"Ausgabe veraltet"} | ${true}
    ${"none"}    | ${"nicht ausgegeben"} | ${true}
  `("Stand $stand: „$wort“, Sprung zum Ausgeben $sprung", async ({ stand, wort, sprung }) => {
    const { onOpen } = await openOverview([einsatz(1, { exported: stand })]);
    expect(days()[0]).toContain(wort);
    expect(!!button("Ausgeben")).toBe(sprung);
    if (!sprung) return;
    // Wenn: der Sprung gewählt wird, dann öffnet sich dieser Einsatz im Schritt Ausgeben
    await act(async () => button("Ausgeben")!.click());
    expect(onOpen).toHaveBeenCalledWith("s1", "export");
  });

  it("öffnet einen Einsatz mit einem Klick auf seinen Namen", async () => {
    const { onOpen } = await openOverview([einsatz(1), einsatz(2)]);
    await act(async () => button("Testmarkt 2")!.click());
    expect(onOpen).toHaveBeenCalledWith("s2");
  });

  it("lässt einen abgewählten Feldtag aus Tabellen und Zwischenablage weg", async () => {
    // Angenommen: zwei Feldtage, beide gewählt
    const { api } = await openOverview([einsatz(1), einsatz(2, { exported: "stale" })]);
    expect(text("overview")).toContain("2 Feldtage");
    // Wenn: der zweite abgewählt und kopiert wird
    await act(async () => checkbox("15.09.2026 Testmarkt 2")!.click());
    await act(async () => button("Tabellen kopieren")!.click());
    // Dann: steht nur der erste in Tabelle und Zwischenablage (als HTML und als Text)
    expect(text("overview")).toContain("1 von 2 Feldtagen gewählt");
    expect(text("overview-tables")).not.toContain("FS-AAA2");
    const [html, plain] = api.copyTable.mock.calls[0]!;
    expect(html).toContain("<table");
    expect(html).toContain("FS-AAA1-BBB1-CCC1");
    expect(html).not.toContain("FS-AAA2");
    expect(plain).toContain("Einsatz\tAusgabe\tDatei\tUmfang\tMontage-ID");
    expect(document.body.textContent).toContain("Als Tabelle kopiert");
    // Und: der abgewählte Tag bietet keinen Sprung zum Ausgeben mehr an
    expect(button("Ausgeben")).toBeUndefined();
  });

  it("kopiert auf Wunsch als Markdown", async () => {
    const { api } = await openOverview([einsatz(1)]);
    await act(async () => button("Als Markdown kopieren")!.click());
    expect(api.copyText.mock.calls[0]![0]).toContain("| Einsatz | Ausgabe | Datei | Umfang | Montage-ID |");
    expect(document.body.textContent).toContain("Als Markdown kopiert");
  });

  it("bittet um eine Auswahl, wenn kein Feldtag gewählt ist", async () => {
    await openOverview([einsatz(1)]);
    await act(async () => checkbox("14.09.2026 Testmarkt 1")!.click());
    expect(text("overview")).toContain("Wähle mindestens einen Feldtag.");
    expect(button("Tabellen kopieren")!.disabled).toBe(true);
  });

  it("erklärt sich in einem Projekt ohne Einsatz", async () => {
    await openOverview([]);
    expect(text("overview")).toContain("Noch kein Einsatz");
    expect(document.querySelector("[data-testid=overview-tables]")).toBeNull();
  });

  it("verweist auf den Mustertext im Handbuch", async () => {
    const { api } = await openOverview([einsatz(1)]);
    await act(async () => button("Mustertext im Handbuch")!.click());
    expect(api.openCitationLink).toHaveBeenCalledWith("https://purl.archive.org/feldspur#sec-methodenteil");
  });

  it("legt die Feldtage im Feldkalender auf eine gemeinsame Uhrzeit-Achse", async () => {
    // Angenommen: zwei Tage mit Marken von 10:00 bis 11:00
    await openOverview([einsatz(1), einsatz(2)]);
    // Dann: reicht die Achse mindestens zwei Stunden bis 11 Uhr, und jede Zeile hat ihre Marken
    const axis = document.querySelector("[data-testid=overview-days] li[aria-hidden]")!.textContent;
    expect(axis).toBe("09:0010:0011:00");
    const strips = document.querySelectorAll("[data-testid=overview-strip]");
    expect(strips).toHaveLength(2);
    expect(strips[0]!.querySelectorAll(".bg-k-video, .bg-k-photo, .bg-k-diary")).toHaveLength(3);
  });

  it("öffnet den Tag aus dem Feldkalender in Durchsehen, mit der Tastatur an der ersten Marke", async () => {
    const { onOpen } = await openOverview([einsatz(1)]);
    // Wenn: die Spur per Tastatur ausgelöst wird (Klick ohne Mausposition)
    await act(async () => document.querySelector<HTMLButtonElement>("[data-testid=overview-strip]")!.click());
    // Dann: öffnet sich der Tag in Durchsehen an der ersten Marke, 10:00
    expect(onOpen).toHaveBeenCalledWith("s1", "review", Date.parse("2026-09-14T10:00:00Z"));
  });

  it("speichert nur die gewählten Tage als Grafik", async () => {
    // Angenommen: zwei Tage, der zweite abgewählt
    const { api } = await openOverview([einsatz(1), einsatz(2)]);
    await act(async () => checkbox("15.09.2026 Testmarkt 2")!.click());
    // Wenn: der Feldkalender gespeichert wird
    await act(async () => button("Feldkalender speichern")!.click());
    // Dann: gehen nur der erste Tag und seine Marken an die App, und der Dateiname wird bestätigt
    const [sent] = api.saveFieldCalendar.mock.calls[0]! as [{ title: string; marks: unknown[] }[]];
    expect(sent.map((d) => d.title)).toEqual(["Testmarkt 1"]);
    expect(sent[0]!.marks).toHaveLength(3);
    expect(document.body.textContent).toContain("Gespeichert als Rundgang_Feldkalender.svg");
  });

  it("gruppiert die Feldtage auf Wunsch nach Ort, Tage ohne Ort zuletzt", async () => {
    // Angenommen: drei Tage an zwei Orten und einer ohne Ort
    await openOverview([
      einsatz(1, { place: "Zoo" }),
      einsatz(2, { place: "" }),
      einsatz(3, { place: "Marktplatz" }),
      einsatz(4, { place: "Zoo" }),
    ]);
    expect(document.querySelectorAll("[data-testid=overview-place]")).toHaveLength(0);
    // Wenn: nach Ort gruppiert wird
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Nach Ort gruppieren"]')!.click());
    // Dann: stehen die Orte in der Folge ihres ersten Tages, innerhalb nach Datum
    const order = [...document.querySelectorAll("[data-testid=overview-days] > li:not([aria-hidden])")].map((li) =>
      li.matches("[data-testid=overview-place]") ? `# ${li.textContent}` : li.textContent!.slice(0, 11),
    );
    expect(order).toEqual([
      "# Zoo2 Feldtage",
      "Testmarkt 1",
      "Testmarkt 4",
      "# Marktplatz1 Feldtag",
      "Testmarkt 3",
      "# Ohne Ort1 Feldtag",
      "Testmarkt 2",
    ]);
  });
});
