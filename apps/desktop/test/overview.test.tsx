// @vitest-environment happy-dom
/**
 * Übersicht des Projekts (`apps/desktop/src/renderer/Overview.tsx`): Feldkalender, Kennwerte und Kopieren, gegen eine
 * nachgestellte Brücke zum Hauptprozess.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  FeldspurApi,
  OverviewSession,
  ProjectExportProgress,
  ProjectExportRequest,
  ProjectExportResult,
} from "../src/shared/api.ts";

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
    farFromDate: 0,
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
async function openOverview(sessions: OverviewSession[], researchers: string[] = []) {
  /** „Alle Einsätze ausgeben…“ bleibt offen, bis der Test es mit `finishProject` beendet. */
  let finishProject: (r: ProjectExportResult | null) => void = () => {};
  let progress: (p: ProjectExportProgress) => void = () => {};
  const api = {
    onExportProgress: vi.fn(() => () => {}),
    onProjectExportProgress: vi.fn((cb: (p: ProjectExportProgress) => void) => {
      progress = cb;
      return () => {};
    }),
    exportProject: vi.fn(
      (_ids: string[], _opts: ProjectExportRequest) =>
        new Promise<ProjectExportResult | null>((done) => {
          finishProject = done;
        }),
    ),
    cancelProjectExport: vi.fn(async () => {}),
    openProjectReadme: vi.fn(async () => true),
    projectOverview: vi.fn(async () => ({
      sessions,
      citation: { version: "0.4.0", released: "2026-12-01", versionDoi: null },
      dataset: {},
      researchers,
    })),
    setProjectDataset: vi.fn(async (d: Record<string, string | undefined>) =>
      Object.fromEntries(Object.entries(d).filter(([, v]) => v?.trim())),
    ),
    copyText: vi.fn(async (_text: string) => {}),
    copyTable: vi.fn(async (_html: string, _text: string) => {}),
    openCitationLink: vi.fn(async (_url: string) => {}),
    saveFieldCalendar: vi.fn(async (_days: unknown[]) => "/tmp/Rundgang_Feldkalender.svg"),
    showInFolder: vi.fn(async (_path: string) => {}),
  };
  (window as unknown as { feldspur: Partial<FeldspurApi> }).feldspur = api;
  vi.resetModules();
  const { Overview } = await import("../src/renderer/Overview.tsx");
  const { ExportProvider } = await import("../src/renderer/exportState.tsx");
  const onOpen = vi.fn((_id: string, _step?: string, _atMs?: number) => {});
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ExportProvider>
        <Overview name="Rundgang" onOpen={onOpen} />
      </ExportProvider>,
    ),
  );
  unmount = () => root.unmount();
  return {
    api,
    onOpen,
    progress: (p: ProjectExportProgress) => act(async () => progress(p)),
    finishProject: (r: ProjectExportResult | null) => act(async () => finishProject(r)),
  };
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
  it("nennt das Projekt, die Einsätze in zeitlicher Folge und fasst sie in den Kennwerten zusammen", async () => {
    await openOverview([einsatz(2), einsatz(1)]);
    expect(text("overview")).toContain("Rundgang");
    expect(text("overview")).toContain("2 Einsätze · 14.09.2026 bis 15.09.2026");
    expect(days().map((d) => d.slice(0, 11))).toEqual(["Testmarkt 1", "Testmarkt 2"]);
    expect(text("overview-tables")).toContain("Eingang: Aufzeichnungen aus 2 Einsätzen (14.09.2026 bis 15.09.2026)");
    expect(text("overview-tables")).toContain("FS-AAA1-BBB1-CCC1");
    expect(text("overview-tables")).toContain("FS-AAA2-BBB2-CCC2");
    expect(text("overview-tables")).toContain("Feldspur, Version 0.4.0");
  });

  it("zeigt je Einsatz gezählte Tatsachen und den Stand der Ausgabe", async () => {
    await openOverview([einsatz(1), einsatz(2, { unsynced: 2, exported: "stale" })]);
    expect(days()[0]).toContain("14.09.2026 · Marktplatz");
    expect(days()[0]).toContain("3 Quellen");
    expect(days()[0]).toContain("Einsatztranskript mit 10 Zeilen");
    expect(days()[0]).toContain("Ausgabe aktuell");
    expect(days()[0]).not.toContain("ohne Abgleich");
    expect(days()[1]).toContain("2 Geräteuhren ohne Abgleich");
    expect(days()[1]).toContain("Ausgabe veraltet");
  });

  it.each`
    stand        | wort                         | sprung
    ${"current"} | ${"Ausgabe aktuell"}         | ${null}
    ${"stale"}   | ${"Ausgabe veraltet"}        | ${"Erneut ausgeben"}
    ${"missing"} | ${"Ausgabe fehlt im Ordner"} | ${"Erneut ausgeben"}
    ${"none"}    | ${"nicht ausgegeben"}        | ${"Ausgeben"}
  `("Stand $stand: „$wort“, Sprung zum Ausgeben: $sprung", async ({ stand, wort, sprung }) => {
    const { onOpen } = await openOverview([einsatz(1, { exported: stand })]);
    expect(days()[0]).toContain(wort);
    expect(!!button("Ausgeben") || !!button("Erneut ausgeben")).toBe(sprung !== null);
    if (sprung === null) return;
    // Wenn: der Sprung gewählt wird, dann öffnet sich dieser Einsatz im Schritt Ausgeben
    await act(async () => button(sprung)!.click());
    expect(onOpen).toHaveBeenCalledWith("s1", "export");
  });

  it("nennt Quellen weit weg vom Datum und führt zum Abgleichen (#226)", async () => {
    // Angenommen: im zweiten Einsatz liegen zwei Quellen weit weg vom Datum
    const { onOpen } = await openOverview([
      einsatz(1),
      einsatz(2, { output: { ...einsatz(2).output, farFromDate: 2 } }),
    ]);
    // Dann: sagt die Zeile des Einsatzes das, die andere nicht
    expect(days()[0]).not.toContain("weit weg");
    expect(days()[1]).toContain("2 Quellen weit weg vom Datum");
    // Und: in den Kennwerten steht statt einer Länge ein Hinweis
    expect(text("overview-tables")).toContain("Länge unklar, 2 Quellen weit weg vom Datum, Echtzeit");
    // Wenn: der Sprung gewählt wird, dann öffnet sich der Einsatz im Schritt Abgleichen
    await act(async () => button("Abgleichen")!.click());
    expect(onOpen).toHaveBeenCalledWith("s2", "sync");
  });

  it("öffnet einen Einsatz mit einem Klick auf seinen Namen", async () => {
    const { onOpen } = await openOverview([einsatz(1), einsatz(2)]);
    await act(async () => button("Testmarkt 2")!.click());
    expect(onOpen).toHaveBeenCalledWith("s2");
  });

  it("lässt einen abgewählten Einsatz aus Tabellen und Zwischenablage weg", async () => {
    // Angenommen: zwei Einsätze, beide gewählt
    const { api } = await openOverview([einsatz(1), einsatz(2, { exported: "stale" })]);
    expect(text("overview")).toContain("2 Einsätze");
    // Wenn: der zweite abgewählt und kopiert wird
    await act(async () => checkbox("15.09.2026 Testmarkt 2")!.click());
    await act(async () => button("Tabellen kopieren")!.click());
    // Dann: steht nur der erste in Tabelle und Zwischenablage (als HTML und als Text)
    expect(text("overview")).toContain("1 von 2 Einsätzen gewählt");
    expect(text("overview-tables")).not.toContain("FS-AAA2");
    const [html, plain] = api.copyTable.mock.calls[0]!;
    expect(html).toContain("<table");
    expect(html).toContain("FS-AAA1-BBB1-CCC1");
    expect(html).not.toContain("FS-AAA2");
    expect(plain).toContain("Einsatz\tAusgabe\tDatei\tUmfang\tMontage-ID");
    expect(document.body.textContent).toContain(
      "Kopiert. Einfügen ergibt in Word, LibreOffice und Pages echte Tabellen.",
    );
    // Und: der abgewählte Tag bietet keinen Sprung zum Ausgeben mehr an
    expect(button("Ausgeben")).toBeUndefined();
  });

  it("nennt im Kopf, wenn alle Ausgaben zum Stand passen", async () => {
    // Angenommen: zwei ausgegebene Tage und einer ohne Quellen (aus ihm lässt sich nichts ausgeben)
    const leer = einsatz(3, {
      sources: 0,
      marks: [],
      exported: "none",
      output: { ...einsatz(3).output, durationMs: 0 },
    });
    await openOverview([einsatz(1), einsatz(2), leer]);
    expect(text("overview-all-current")).toContain("Alle Ausgaben aktuell");
  });

  it("sagt nichts über alle Ausgaben, solange eine veraltet ist", async () => {
    await openOverview([einsatz(1), einsatz(2, { exported: "stale" })]);
    expect(document.querySelector("[data-testid=overview-all-current]")).toBeNull();
  });

  it("führt von einem Einsatz ohne Quellen zum Einsammeln", async () => {
    const leer = einsatz(1, {
      sources: 0,
      marks: [],
      exported: "none",
      output: { ...einsatz(1).output, durationMs: 0 },
    });
    const { onOpen } = await openOverview([leer]);
    expect(days()[0]).toContain("Noch nichts eingesammelt");
    expect(days()[0]).not.toContain("nicht ausgegeben");
    await act(async () => button("Einsammeln")!.click());
    expect(onOpen).toHaveBeenCalledWith("s1", "collect");
  });

  it("zeigt die Uhrzeit unter dem Mauszeiger über allen Tagen und nimmt sie beim Verlassen zurück", async () => {
    // Angenommen: Achse 09:00 bis 11:00, die Spur ist 200 px breit
    await openOverview([einsatz(1), einsatz(2)]);
    const strip = document.querySelector<HTMLButtonElement>("[data-testid=overview-strip]")!;
    strip.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect;
    const list = document.querySelector<HTMLElement>("[data-testid=overview-days]")!;
    // Wenn: die Maus bei drei Vierteln der Spur steht
    await act(async () => strip.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 250 })));
    // Dann: steht 10:30 an der Achse, und die Linie liegt in jeder Zeile an derselben Stelle
    expect(text("overview-hover-clock")).toBe("10:30");
    expect(list.style.getPropertyValue("--at")).toBe("75%");
    expect(list.dataset.hover).toBe("");
    // Wenn: die Maus die Spur verlässt, dann ist die Linie weg
    await act(async () => strip.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(list.dataset.hover).toBeUndefined();
  });

  it("kopiert auf Wunsch als Markdown", async () => {
    const { api } = await openOverview([einsatz(1)]);
    await act(async () => button("Als Markdown kopieren")!.click());
    expect(api.copyText.mock.calls[0]![0]).toContain("| Einsatz | Ausgabe | Datei | Umfang | Montage-ID |");
    expect(document.body.textContent).toContain("Als Markdown kopiert");
  });

  it("bittet um eine Auswahl, wenn kein Einsatz gewählt ist", async () => {
    await openOverview([einsatz(1)]);
    await act(async () => checkbox("14.09.2026 Testmarkt 1")!.click());
    expect(text("overview")).toContain("Kein Einsatz gewählt.");
    expect(button("Tabellen kopieren")!.disabled).toBe(true);
  });

  it("erklärt sich in einem Projekt ohne Einsatz", async () => {
    await openOverview([]);
    expect(text("overview")).toContain("Noch kein Einsatz");
    expect(document.querySelector("[data-testid=overview-tables]")).toBeNull();
  });

  it("verweist auf den Mustertext im Handbuch", async () => {
    const { api } = await openOverview([einsatz(1)]);
    await act(async () => button("„Im Methodenteil beschreiben“ im Handbuch")!.click());
    expect(api.openCitationLink).toHaveBeenCalledWith("https://purl.archive.org/feldspur#sec-methodenteil");
  });

  it("legt die Einsätze im Feldkalender auf eine gemeinsame Uhrzeit-Achse", async () => {
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
    await act(async () => button("Als Grafik speichern")!.click());
    // Dann: gehen nur der erste Tag und seine Marken an die App, und der Dateiname wird bestätigt
    const [sent] = api.saveFieldCalendar.mock.calls[0]! as [{ title: string; marks: unknown[] }[]];
    expect(sent.map((d) => d.title)).toEqual(["Testmarkt 1"]);
    expect(sent[0]!.marks).toHaveLength(3);
    expect(document.body.textContent).toContain("Gespeichert als Rundgang_Feldkalender.svg");
    // Wenn: „Im Ordner zeigen“ gewählt wird, dann zeigt die App die gespeicherte Datei
    await act(async () => button("Im Ordner zeigen")!.click());
    expect(api.showInFolder).toHaveBeenCalledWith("/tmp/Rundgang_Feldkalender.svg");
  });

  it("gruppiert die Einsätze auf Wunsch nach Ort, Einsätze ohne Ort zuletzt", async () => {
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
      "# Zoo2 Einsätze",
      "Testmarkt 1",
      "Testmarkt 4",
      "# Marktplatz1 Einsatz",
      "Testmarkt 3",
      "# Ohne Ort1 Einsatz",
      "Testmarkt 2",
    ]);
  });

  it("speichert die Angaben zum Datensatz erst mit „Speichern“ und schlägt die Forschenden als Urheber*innen vor", async () => {
    const { api } = await openOverview([einsatz(1)], ["Mara Beispiel"]);
    const card = document.querySelector("[data-testid=dataset-card]")!;
    const field = (key: string) => card.querySelector<HTMLInputElement>(`[data-field=${key}]`)!;
    // Angenommen: noch nichts eingetragen; die Forschenden stehen als Vorschlag da, Zugang hat keine Vorgabe
    expect(field("creators").textContent).toContain("Ohne Eintrag gelten die Forschenden an den Geräten");
    expect(button("Mara Beispiel")).toBeTruthy();
    expect(field("access").value).toBe("");
    expect(card.querySelector("[aria-pressed=true]")).toBeNull();
    // Beim ersten Mal nennt die Karte einen leichten Einstieg und schlägt den Namen des Projekts als Titel vor
    expect(card.textContent).toContain("Für den Anfang genügen ein Titel und die Urheber*innen");
    expect(button("Rundgang")).toBeTruthy();
    expect(button("Speichern")!.disabled).toBe(true);
    // Wenn: ein Titel getippt wird, dann lässt er sich speichern
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(field("title"), "Marktstudie");
      field("title").dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button("Speichern")!.disabled).toBe(false);
    await act(async () => button("Speichern")!.click());
    // Dann: geht er an den Hauptprozess, und die Karte meldet „Gespeichert“
    expect(api.setProjectDataset).toHaveBeenCalledWith({ title: "Marktstudie" });
    expect(card.textContent).toContain("Gespeichert");
    // Die Vorschau zeigt den Titel und leuchtet nach dem Speichern einmal auf.
    const preview = card.querySelector("[data-testid=dataset-preview]")!;
    expect(preview.textContent).toContain("Titel des DatensatzesMarktstudie");
    expect(preview.querySelector(".settle-once")).not.toBeNull();
    expect(card.textContent).not.toContain("Für den Anfang genügen");
    expect(button("Speichern")!.disabled).toBe(true);
  });
});

describe("Alle Einsätze ausgeben", () => {
  /** Ergebnis eines Laufs über die Einsätze 1 und 2; `zweiter` sagt, was aus dem zweiten wurde. */
  const ergebnis = (zweiter: Partial<ProjectExportResult["sessions"][number]> = {}): ProjectExportResult => {
    const second = {
      sessionId: "s2",
      title: "Testmarkt 2",
      date: "2026-09-15",
      outcome: "written" as const,
      ...zweiter,
    };
    const complete = second.outcome === "written" || second.outcome === "unchanged";
    return {
      dir: "/tmp/Rundgang",
      sessions: [{ sessionId: "s1", title: "Testmarkt 1", date: "2026-09-14", outcome: "unchanged" }, second],
      complete,
      files: complete ? ["LIESMICH.html"] : [],
      cancelled: false,
    };
  };

  it("gibt die Einsätze mit Häkchen aus, mit den Schaltern aus dem Schritt Ausgeben", async () => {
    // Angenommen: drei Einsätze, einer ohne Quelle mit Uhrzeit; im Schritt Ausgeben ist das Video abgewählt
    localStorage.setItem("feldspur.export-options", JSON.stringify({ video: false, viewer: false, roCrate: true }));
    const leer = einsatz(3, { output: { ...einsatz(3).output, durationMs: 0 }, exported: "none" });
    const { api } = await openOverview([einsatz(1), einsatz(2), leer]);
    expect(button("Alle Einsätze ausgeben…")).toBeTruthy();
    // Wenn: der erste abgewählt und dann ausgegeben wird
    await act(async () => checkbox("14.09.2026 Testmarkt 1")!.click());
    await act(async () => button("1 von 3 Einsätzen ausgeben…")!.click());
    // Dann: geht nur der zweite in den Projektordner, ohne Video und mit Metadaten
    expect(api.exportProject).toHaveBeenCalledOnce();
    expect(api.exportProject.mock.calls[0]![0]).toEqual(["s2"]);
    expect(api.exportProject.mock.calls[0]![1]).toMatchObject({ video: false, roCrate: true, realtime: true });
  });

  it("zeigt, welcher Einsatz an der Reihe ist, und lässt sich abbrechen", async () => {
    const { api, progress } = await openOverview([einsatz(1), einsatz(2)]);
    // Wenn: der Lauf beginnt, dann sperrt der Knopf und die Karte sagt, was geschieht
    await act(async () => button("Alle Einsätze ausgeben…")!.click());
    expect(button("Gibt aus…")!.disabled).toBe(true);
    expect(text("project-export")).toContain("Projektordner wird geschrieben");
    expect(text("project-export")).toContain("dazu Montagevideo, Viewer und LIESMICH");
    // Wenn: der zweite Einsatz an der Reihe ist
    await progress({ index: 1, total: 2, sessionId: "s2" });
    expect(text("project-export-at")).toBe("Einsatz 2 von 2 · Testmarkt 2 · 15.09.2026");
    // Wenn: abgebrochen wird, dann gilt das dem ganzen Lauf
    await act(async () => button("Abbrechen")!.click());
    expect(api.cancelProjectExport).toHaveBeenCalledOnce();
    expect(text("project-export")).toContain("Bricht ab…");
  });

  it("meldet den fertigen Projektordner, öffnet seine LIESMICH und zählt die Übersicht neu", async () => {
    const { api, finishProject } = await openOverview([einsatz(1), einsatz(2)]);
    await act(async () => button("Alle Einsätze ausgeben…")!.click());
    // Wenn: der Lauf vollständig endet
    await finishProject(ergebnis());
    // Dann: steht das Ergebnis je Einsatz da, und die Übersicht hat neu gezählt
    expect(text("project-export-result")).toContain("Projektordner geschrieben");
    expect(text("project-export")).toContain("1 Einsatz neu ausgegeben, 1 unverändert übernommen.");
    expect(text("project-export-sessions")).toContain("14.09.2026 Testmarkt 1Unverändert, nicht neu ausgegeben");
    expect(api.projectOverview).toHaveBeenCalledTimes(2);
    // Wenn: die LIESMICH geöffnet und die Meldung geschlossen wird
    await act(async () => button("LIESMICH öffnen")!.click());
    expect(api.openProjectReadme).toHaveBeenCalledOnce();
    await act(async () => button("Schließen")!.click());
    expect(document.querySelector("[data-testid=project-export]")).toBeNull();
  });

  it("sagt, was fehlt, wenn ein Einsatz angehalten wurde, und gibt ihn auf Wunsch trotzdem aus", async () => {
    const { api, onOpen, finishProject } = await openOverview([einsatz(1), einsatz(2)]);
    await act(async () => button("Alle Einsätze ausgeben…")!.click());
    // Wenn: die Prüfung der Originale den zweiten Einsatz anhält
    await finishProject(ergebnis({ outcome: "held", blocking: false, detail: "1 Original ist verändert oder fehlt." }));
    // Dann: ist der Ordner nicht vollständig, und die Zeile nennt den Grund
    expect(text("project-export-result")).toBe("Der Projektordner ist noch nicht vollständig");
    expect(text("project-export-sessions")).toContain("Angehalten: 1 Original ist verändert oder fehlt.");
    // Wenn: der Sprung in den Einsatz gewählt wird
    await act(async () => button("Im Einsatz ansehen")!.click());
    expect(onOpen).toHaveBeenCalledWith("s2", "export");
    // Wenn: „Trotzdem ausgeben“ gewählt wird, dann läuft es in denselben Ordner, nur für diesen Einsatz ohne Halt
    await act(async () => button("Trotzdem ausgeben")!.click());
    expect(api.exportProject.mock.calls[1]![0]).toEqual(["s1", "s2"]);
    expect(api.exportProject.mock.calls[1]![1]).toMatchObject({ dir: "/tmp/Rundgang", accept: ["s2"] });
  });

  it("bietet bei fehlenden Originalen kein „Trotzdem ausgeben“ an", async () => {
    const { finishProject } = await openOverview([einsatz(1), einsatz(2)]);
    await act(async () => button("Alle Einsätze ausgeben…")!.click());
    await finishProject(
      ergebnis({ outcome: "held", blocking: true, detail: "1 Original fehlt oder ist nicht lesbar." }),
    );
    expect(button("Trotzdem ausgeben")).toBeUndefined();
    expect(button("Im Einsatz ansehen")).toBeTruthy();
  });
});
