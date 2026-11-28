/**
 * Handbuch-Rundgang: geht die Kapitel des Handbuchs in der laufenden App durch, mit echten Klicks und Tasten.
 *
 * Jede Prüfung nennt einen Begriff, wie er im Handbuch fett steht, und prüft beides:
 *   1. Das Handbuch-Kapitel enthält ihn (fett, also `**Begriff**`).
 *   2. Die App zeigt ihn an der Stelle, die das Handbuch beschreibt (Knopf, Menüpunkt, Beschriftung).
 * Benennt jemand einen Knopf um, ohne das Handbuch mitzuziehen (oder umgekehrt), schlägt der Test an.
 *
 *   vp run e2e                                   (Linux ohne Bildschirm: xvfb-run -a …)
 *   FELDSPUR_SCREENSHOT=rundgang.png …           ein Bildschirmfoto je Kapitel (rundgang-einsammeln.png …)
 *   FELDSPUR_HANDBUCH_BERICHT=bericht.md …       alle Prüfungen als Tabelle
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Locator, type Page } from "playwright-core";
import { makeDiaryPage, makePhoto, makeSyncDay } from "../../../packages/media/test/fixtures.ts";
import { ablauf } from "./ablauf.ts";

const handbuch = join(import.meta.dirname, "../../../handbuch");
/** Kapiteltext ohne Zeilenumbrüche, damit fette Begriffe über Zeilenenden hinweg gefunden werden. */
const kapitelText = new Map<string, string>();
const textOf = (k: string) => {
  if (!kapitelText.has(k))
    kapitelText.set(
      k,
      // Kapitel der Anleitung heißen _handbuch-*.qmd, Abschnitte des Begleittexts (etwa „zitieren“) nur _*.qmd.
      readFileSync(
        join(handbuch, existsSync(join(handbuch, `_handbuch-${k}.qmd`)) ? `_handbuch-${k}.qmd` : `_${k}.qmd`),
        "utf8",
      ).replace(/\s*\n\s*/g, " "),
    );
  return kapitelText.get(k)!;
};

interface Befund {
  kapitel: string;
  begriff: string;
  imHandbuch: boolean;
  inApp: boolean;
  hinweis?: string;
}
const befunde: Befund[] = [];
const abbrueche: string[] = [];

const dir = mkdtempSync(join(tmpdir(), "feldspur-handbuch-"));
const quellen = join(dir, "Rohquellen");
makeSyncDay(quellen);
makePhoto(join(quellen, "IMG_20260914_104050.jpg"), "0x1f8a70");
makePhoto(join(quellen, "Marktstand.jpg"), "0x2a52be"); // ohne jede Zeitangabe
makeDiaryPage(join(quellen, "Tagebuch_S01.jpg"), 1);
makeDiaryPage(join(quellen, "Tagebuch_S02.jpg"), 2);

const sandbox = process.env.CI || process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const env = { ...process.env, FELDSPUR_USER_DATA: join(dir, "Benutzerordner") };
const launch = (args: string[]) =>
  electron.launch({ args: [".", ...args, ...sandbox], cwd: join(import.meta.dirname, ".."), env });

let app: ElectronApplication;
let page: Page;
let aktuell = "";
let bildNr = 0;

/**
 * Prüft einen Begriff in Handbuch und App. `ort` findet ihn in der App; ohne Angabe ein Knopf mit genau diesem Namen.
 * `handbuch` ist die Schreibweise im Handbuch, falls sie nicht `**begriff**` ist.
 */
async function siehe(
  begriff: string,
  ort?: Locator,
  opts: { handbuch?: string; hinweis?: string; kapitel?: string } = {},
) {
  const imHandbuch = textOf(opts.kapitel ?? aktuell).includes(opts.handbuch ?? `**${begriff}**`);
  const loc = (ort ?? page.getByRole("button", { name: begriff, exact: true })).first();
  const inApp = await loc
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  befunde.push({ kapitel: aktuell, begriff, imHandbuch, inApp, hinweis: opts.hinweis });
  console.log(
    `${imHandbuch && inApp ? "✓" : "✗"} ${aktuell}: ${begriff}${imHandbuch ? "" : " (fehlt im Handbuch)"}${inApp ? "" : " (fehlt in der App)"}`,
  );
}
const knopf = (name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" });
const menu = (name: string | RegExp) =>
  page.getByRole("menu").getByText(typeof name === "string" ? new RegExp(`^${esc(name)}`) : name);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Ein Kapitel des Handbuchs, gegliedert in Abläufe; bricht eines ab, geht der Rundgang mit dem nächsten Kapitel weiter. */
async function kapitel(name: string, schritte: () => Promise<void>) {
  aktuell = name;
  console.log("");
  try {
    await ablauf(name, schritte);
  } catch (e) {
    // Die Meldung beginnt schon mit „Kapitel › Ablauf: “.
    const zeilen = (e as Error).message.split("\n");
    const msg = [zeilen[0], zeilen.find((z) => z.includes("waiting for"))?.trim()].filter(Boolean).join(" · ");
    abbrueche.push(msg);
    console.log(`! abgebrochen: ${msg}`);
    await page.keyboard.press("Escape").catch(() => {});
  }
  if (process.env.FELDSPUR_SCREENSHOT)
    await page
      .screenshot({ path: process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, `-${++bildNr}-${name}.png`) })
      .catch(() => {});
}
const schliessen = async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
};

// Startbildschirm: ohne Projekt starten.
aktuell = "erste-schritte";
console.log("— erste-schritte (Startbildschirm)");
app = await launch([]);
page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
await siehe("Neues Projekt…");
await siehe("Projekt öffnen…");
await app.close();

app = await launch([join(dir, "Rundgang.feldspur")]);
page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
let sessionId = "";
const src = (name: string) => page.getByTestId("source").filter({ hasText: name }).first();
/** „⋯“-Menü einer Quelle in Einsammeln (steht neben dem Eintrag, nicht darin). */
const quellenMenu = (name: string) =>
  page
    .locator("li")
    .filter({ has: src(name) })
    .getByRole("button", { name: /^Aktionen für/ });
const inspector = () => page.getByTestId("inspector");

await kapitel("erste-schritte", async () => {
  await ablauf("Einen Einsatz anlegen", async () => {
    await siehe("Einsatz anlegen");
    await page.getByLabel("Titel").fill("Wochenmarkt");
    await page.getByLabel("Datum").fill("2026-09-14");
    await page.getByLabel("Ort").fill("Marktplatz");
    await knopf("Einsatz anlegen").click();
    await page.getByRole("heading", { name: "Wochenmarkt" }).waitFor();
    sessionId = await page.evaluate(async () => (await window.feldspur.currentProject())!.sessions[0]!.id);
    await siehe("+ neuer Einsatz", page.getByText("+ neuer Einsatz", { exact: true }));
    for (const s of ["Einsammeln", "Abgleichen", "Durchsehen", "Ausgeben"])
      await siehe(s, page.getByRole("tab", { name: new RegExp(s) }));
    await siehe("Detailleiste", page.getByTestId("inspector"), { hinweis: "rechte Leiste" });
    await siehe("Suchen", knopf(/^Suchen/));
    await siehe("Rückgängig", knopf("Rückgängig"));
    await siehe("Wiederholen", knopf("Wiederholen"));
    await page.keyboard.press("Control+k");
    await siehe("Suchen", page.getByTestId("search"), {
      handbuch: "([Strg+K]{.kbd}, auf dem Mac [⌘+K]{.kbd})",
      hinweis: "Strg+K öffnet die Suche",
    });
    await schliessen();
  });

  await ablauf("Einsatzdaten bearbeiten", async () => {
    await knopf("Einsatzdaten bearbeiten…").click();
    const d = page.getByTestId("session-details");
    await siehe("Einsatzdaten bearbeiten…", d);
    await siehe("Ort", d.getByLabel("Ort", { exact: true }));
    await siehe("Zeitzone", d.getByLabel("Zeitzone"));
    await siehe("Bezugszeitraum Tagebuch", d.getByText("Bezugszeitraum Tagebuch"));
    await siehe("Weitere Angaben", d.getByText("Weitere Angaben"));
    await siehe("+ Feld", d.getByRole("button", { name: "+ Feld" }));
    await siehe("Einsatz löschen…", d.getByRole("button", { name: "Einsatz löschen…" }));
    await schliessen();
  });

  await ablauf("Das Projektmenü", async () => {
    const projektMenu = async () => {
      await page.getByTestId("project-menu").click();
      await page.getByRole("menu").waitFor();
    };
    await projektMenu();
    await siehe("Anderes Projekt öffnen…", menu("Anderes Projekt öffnen…"));
    await siehe("Neues Projekt…", menu("Neues Projekt…"));
    await siehe("Änderungsprotokoll…", menu("Änderungsprotokoll…"));
    await siehe("Sicherungen…", menu("Sicherungen…"));
    await page.getByRole("menuitem", { name: "Änderungsprotokoll…" }).click();
    await siehe("Als CSV speichern…");
    await schliessen();
    await projektMenu();
    await page.getByRole("menuitem", { name: "Sicherungen…" }).click();
    await siehe("Sicherung erstellen…");
    // Speichern-Dialog: den vorgeschlagenen Namen übernehmen.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async (...a: unknown[]) => ({
        canceled: false,
        filePath: (a.at(-1) as { defaultPath: string }).defaultPath,
      })) as typeof dialog.showSaveDialog;
    });
    await knopf("Sicherung erstellen…").click();
    await page.getByTestId("backup-row").first().waitFor();
    await siehe("Als Kopie öffnen…", knopf(/Als Kopie öffnen…/), {
      hinweis: "steht an jeder Sicherung; ohne Sicherung fehlt er",
    });
    await siehe("Andere Datei als Kopie öffnen…");
    await siehe("Ordner zeigen");
    await schliessen();
  });

  await ablauf("Feldspur zitieren", async () => {
    const zitieren = { kapitel: "zitieren" };
    await siehe("Zitieren…", knopf("Zitieren…"), zitieren);
    await knopf("Zitieren…").click();
    const d = page.getByTestId("citation-dialog");
    await siehe("Feldspur zitieren", d.getByRole("heading", { name: "Feldspur zitieren" }), zitieren);
    await siehe("Zitat kopieren", d.getByRole("button", { name: "Zitat kopieren" }), zitieren);
    await siehe("DOI für alle Versionen", d.getByText(/DOI für alle Versionen/).first(), zitieren);
    await siehe(
      "DOI bei Zenodo nachschlagen",
      d.getByRole("button", { name: "DOI bei Zenodo nachschlagen" }),
      zitieren,
    );
    await schliessen();
  });
});

await kapitel("einsammeln", async () => {
  await ablauf("Dateien einsammeln", async () => {
    await page.getByRole("tab", { name: /Einsammeln/ }).click();
    await siehe("Dateien wählen…");
    await page.evaluate(async ([id, p]) => window.feldspur.importPaths(id!, [p!]), [sessionId, quellen]);
    await page.reload();
    await page.getByRole("tab", { name: /Einsammeln/ }).click();
    await src("ZOOM0001.m4a").waitFor();
  });

  const kamera = await ablauf("Ein Gerät umbenennen", async () => {
    // Wenn: auf den Namen geklickt wird, dann lässt er sich ändern
    const kamera = page.getByTestId("device-card").filter({ hasText: /C0001\.MP4/ });
    await kamera.getByTestId("device-name").click();
    await siehe("Umbenennen", kamera.getByLabel(/^Name für/), { hinweis: "Klick auf den Gerätenamen" });
    await kamera.getByLabel(/^Name für/).fill("Kamera Stativ");
    await kamera.getByLabel(/^Name für/).press("Enter");
    return kamera;
  });

  await ablauf("Das Menü einer Quelle", async () => {
    // Menü einer Quelle (Foto)
    await quellenMenu("Marktstand.jpg").click();
    await siehe("In anderes Gerät verschieben", menu("In anderes Gerät verschieben"));
    await siehe("Als weiteres Bild zu Seite …", menu("Als weiteres Bild zu Seite …"));
    await siehe("Als Tagebuchseite behandeln", menu("Als Tagebuchseite behandeln"));
    await siehe("Aus Projekt entfernen", menu("Aus Projekt entfernen"));
    await page.getByRole("menuitem", { name: "In anderes Gerät verschieben" }).hover();
    await siehe("Neues Gerät…", menu("Neues Gerät…"));
    await schliessen();
    await schliessen();
    // Menü einer Tagebuchseite
    await quellenMenu("Tagebuch_S01.jpg").click();
    await siehe("Als Foto behandeln", menu("Als Foto behandeln"));
    await siehe("Seite als Kontext führen", menu("Seite als Kontext führen"), { kapitel: "tagebuch" });
    await schliessen();
    // Menü einer Tonaufnahme
    await quellenMenu("C0002.MP4").click();
    await siehe("Setzt Aufnahme fort …", menu("Setzt Aufnahme fort …"));
    await siehe("Mitschreiben…", menu("Mitschreiben…"), { kapitel: "mitschreiben" });
    await schliessen();
  });

  await ablauf("Das Menü eines Geräts", async () => {
    await kamera.getByRole("button", { name: /^Aktionen für Gerät/ }).click();
    await siehe("Zusammenlegen mit …", menu("Zusammenlegen mit …"));
    await siehe("Zeitzone der Geräteuhr", menu("Zeitzone der Geräteuhr"));
    await siehe("Zeitbelege neu lesen", menu("Zeitbelege neu lesen"));
    await siehe("Zeitstempel in UTC", menu("Zeitstempel in UTC"));
    await siehe("Sind UTC, in Ortszeit umrechnen", menu("Sind UTC, in Ortszeit umrechnen"));
    await siehe("Sind schon Ortszeit, so lesen", menu("Sind schon Ortszeit, so lesen"));
    await schliessen();

    await siehe("Weiter: Uhren abgleichen →");
  });
});

await kapitel("abgleichen", async () => {
  const vorschlag = await ablauf("Uhren abgleichen", async () => {
    await knopf("Weiter: Uhren abgleichen →").click();
    const uhr = (geraet: string) => page.locator(`[data-testid=clock][data-device*="${geraet}"]`);
    await siehe("als Referenz", uhr("ZOOM").getByRole("button", { name: "als Referenz" }));
    await uhr("ZOOM").getByRole("button", { name: "als Referenz" }).click();
    await uhr("ZOOM").getByText("Referenzuhr").waitFor();
    await siehe("Tonspuren abgleichen");
    await knopf("Tonspuren abgleichen").click();
    const vorschlag = page.getByTestId("proposal").first();
    await vorschlag.waitFor({ timeout: 90_000 });
    await siehe("Übernehmen", vorschlag.getByRole("button", { name: "Übernehmen" }), { handbuch: "**übernimmst**" });
    await siehe("Verwerfen", vorschlag.getByRole("button", { name: "Verwerfen" }), { handbuch: "**verwirfst**" });
    await siehe("Fein justieren…", vorschlag.getByRole("button", { name: "Fein justieren…" }));
    await siehe("Alle eindeutigen übernehmen", knopf(/^Alle eindeutigen übernehmen/), {
      handbuch: "**Alle eindeutigen übernehmen**",
    });
    return vorschlag;
  });

  await ablauf("Fein justieren", async () => {
    await vorschlag.getByRole("button", { name: "Fein justieren…" }).click();
    await siehe("Einrasten");
    await siehe("Anhören", knopf(/Anhören/));
    await schliessen();

    await knopf(/^Alle eindeutigen übernehmen/).click();
    await page
      .getByText(/Uhren stimmen jetzt überein/)
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await siehe("Beleg", page.getByTestId("anchor-proof"), { handbuch: "als Beleg der Anker" });
    await siehe("Beide anhören", page.getByTestId("anchor-proof").getByRole("button", { name: /Beide anhören/ }));
    await siehe("+ Neuer Anker");
    const weiter = knopf("Weiter: Durchsehen →");
    await siehe("Weiter: Durchsehen →", weiter);
  });

  await ablauf("Eine Uhrzeit von Hand eintragen", async () => {
    // Wenn: ein Foto ohne Zeit gewählt wird, dann lässt sich in der Detailleiste eine Uhrzeit eintragen
    await page
      .getByTestId("tray-item")
      .filter({ hasText: "Marktstand.jpg" })
      .first()
      .click()
      .catch(async () => {
        await page.getByRole("tab", { name: /Durchsehen/ }).click();
        await page.getByTestId("tray-item").filter({ hasText: "Marktstand.jpg" }).first().click();
      });
    const form = page.getByTestId("time-form");
    if (!(await form.isVisible()))
      await inspector()
        .getByRole("button", { name: /^\+ Uhrzeit eintragen/ })
        .click();
    await siehe("Eintragen", form.getByRole("button", { name: "Eintragen" }), { handbuch: "**Eintragen**" });
    await form.getByLabel("Uhrzeit").pressSequentially("103000");
    await form.getByRole("button", { name: "Eintragen" }).click();
    await inspector()
      .getByText(/^10:30:00/)
      .first()
      .waitFor();
  });

  await ablauf("Eine Ansage in einer Tonaufnahme markieren", async () => {
    // Wenn: eine Tonaufnahme gewählt wird, dann heißt der Link anders und bietet Von Hand und Angesagt
    await page.getByRole("tab", { name: /Durchsehen/ }).click();
    await page
      .getByTestId("tl-clip")
      .filter({ hasText: /ZOOM0001/ })
      .first()
      .evaluate((b) => (b as HTMLElement).click());
    await siehe(
      "+ Uhrzeit eintragen oder Ansage markieren",
      inspector().getByRole("button", { name: "+ Uhrzeit eintragen oder Ansage markieren" }),
      { handbuch: "**+ Uhrzeit eintragen oder Ansage markieren**" },
    );
    await inspector().getByRole("button", { name: "+ Uhrzeit eintragen oder Ansage markieren" }).click();
    await siehe("Angesagt", page.getByTestId("time-form").getByText("Angesagt"));
    await siehe("Von Hand", page.getByTestId("time-form").getByText("Von Hand"));
  });
});

await kapitel("durchsehen", async () => {
  await ablauf("Die Zeitachse durchsehen", async () => {
    await page.getByRole("tab", { name: /Durchsehen/ }).click();
    await page.getByTestId("track").first().waitFor();
    // Ohne gewählte Quelle zeigt die Detailleiste den Stand des Einsatzes mit dem Balken.
    const schliessenKnopf = inspector().getByRole("button", { name: "Schließen" });
    if (await schliessenKnopf.isVisible().catch(() => false)) await schliessenKnopf.first().click();
    await siehe("Stand des Einsatzes", inspector().getByText("Stand des Einsatzes", { exact: true }));
    await siehe("Stille (≥ 5 Min.)", page.getByText("Stille (≥ 5 Min.)"));
    await siehe("laute Stelle in der Stille", page.getByText(/^laute Stelle in der Stille/));
    await siehe("Lage prüfen", page.getByText(/^Lage prüfen/));
    await siehe("Einpassen");
    await siehe("Episoden bilden", page.getByRole("switch", { name: "Episoden bilden" }));
    await siehe("Zu prüfen", page.getByText(/^Zu prüfen \(/));
    await siehe("Ohne Uhrzeit", page.getByText(/^Ohne Uhrzeit/), { handbuch: "**Ohne Uhrzeit**" });
    for (const f of ["Widerspruch stark", "Widerspruch deutlich", "Unsichere Lage", "Entschieden"])
      await siehe(
        f,
        page
          .getByRole("button", { name: new RegExp(`^${f}`) })
          .or(page.getByRole("radio", { name: new RegExp(`^${f}`) })),
      );
    await siehe("nach Uhrzeit", page.getByText("nach Uhrzeit"));
  });

  await ablauf("Lagen prüfen", async () => {
    const naechste = page.getByTestId("next-check");
    if (await naechste.count()) {
      await siehe("zu prüfen · Nächste →", naechste.getByText(/zu prüfen · Nächste →/), {
        handbuch: "zu prüfen · Nächste →",
      });
      await naechste.click();
      const panel = page.getByTestId("check-panel");
      await siehe(
        "✓ Lage passt, als geprüft markieren",
        panel.getByRole("button", { name: "✓ Lage passt, als geprüft markieren" }),
      );
      const kurz = await page.getByTestId("inspector-head").locator("b.font-mono").innerText();
      await panel.getByRole("button", { name: "✓ Lage passt, als geprüft markieren" }).click();
      await page.getByTestId("undo-toast").getByText(`Lage bestätigt: ${kurz}`).waitFor();
      // Feldspur springt zur nächsten Stelle; die bestätigte Quelle wieder wählen.
      await page
        .locator("[data-testid^=tl-]")
        .filter({ hasText: kurz })
        .first()
        .evaluate((b) => (b as HTMLElement).click());
      await siehe("Von Hand geprüft: Die Lage passt.", page.getByText("Von Hand geprüft: Die Lage passt."));
      await siehe("Zurücknehmen", inspector().getByRole("button", { name: "Zurücknehmen" }));
    } else {
      befunde.push({
        kapitel: aktuell,
        begriff: "zu prüfen · Nächste →",
        imHandbuch: true,
        inApp: false,
        hinweis: "keine unsichere Lage im Testmaterial",
      });
    }
  });

  await ablauf("Die Lautstärke einer Tonquelle", async () => {
    await page
      .getByTestId("tl-clip")
      .filter({ hasText: /ZOOM0001/ })
      .first()
      .evaluate((b) => (b as HTMLElement).click());
    await siehe("Lautstärke", inspector().getByText(/^Lautstärke/));
    for (const o of ["automatisch", "von Hand", "aus"])
      await siehe(o, inspector().getByText(o, { exact: true }), { handbuch: `**${o}**` });
    await siehe("Leise Stellen anheben", inspector().getByText(/^Leise Stellen anheben/));
  });

  await ablauf("Episoden bilden", async () => {
    await page.getByRole("switch", { name: "Episoden bilden" }).click();
    await page.getByTestId("episode").first().waitFor({ state: "attached" });
  });
});

await kapitel("tagebuch", async () => {
  await ablauf("Eine Tagebuchseite abtippen", async () => {
    await page.getByTestId("tray-item").filter({ hasText: "Tagebuch_S01.jpg" }).click();
    await siehe("Randnotiz", inspector().getByLabel("Randnotiz T-01"));
    await inspector().getByLabel("Randnotiz T-01").pressSequentially("1012");
    await inspector().getByLabel("Randnotiz T-01").press("Enter");
    const zaehlung = page.getByTestId("page-numbering");
    await siehe("Seitenzählung", zaehlung);
    await siehe("Doppelseite", page.getByLabel("Doppelseite T-01"));
    await zaehlung.getByLabel("Seitenzahl im Notizbuch für T-01").fill("1");
    await zaehlung.getByLabel("Seitenzahl im Notizbuch für T-01").press("Enter");
    await siehe("weiterzählen", page.getByTestId("page-numbering").getByRole("button", { name: /weiterzählen$/ }), {
      handbuch: "weiterzählen**",
    });
    await siehe("Abtippen…", inspector().getByRole("button", { name: "Abtippen…" }));
    await inspector().getByRole("button", { name: "Abtippen…" }).click();
    const ed = page.getByTestId("diary-editor");
    await ed.waitFor();
    for (const m of ["Nur Scan", "Kurzform", "Volltext"]) await siehe(m, ed.getByRole("radio", { name: m }));
    await siehe("Gehört zu", ed.getByText("Gehört zu"));
    await siehe("Kontext", ed.getByRole("radio", { name: "Kontext" }));
    await siehe("auf anderer Seite fortsetzen", ed.getByRole("button", { name: "auf anderer Seite fortsetzen" }));
    await siehe("Fertig", ed.getByRole("button", { name: "Fertig" }));
    await ed.getByRole("button", { name: "Fertig" }).click();
    await ed.waitFor({ state: "detached" });
  });

  await ablauf("Kontext führen", async () => {
    // Wenn: Seite 2 über das Menü Kontext wird und ein getipptes Stück dazukommt
    await page.getByRole("tab", { name: /Einsammeln/ }).click();
    await quellenMenu("Tagebuch_S02.jpg").click();
    await page.getByRole("menuitem", { name: "Seite als Kontext führen" }).click();
    await page.getByRole("tab", { name: /Durchsehen/ }).click();
    await siehe("+ Text", page.getByTestId("context-strip").getByText("+ Text"));
    await page.getByTestId("context-new-text").click();
    await page.getByTestId("context-title").fill("Zusammenfassung vom Abend");
    await page.getByTestId("context-title").press("Enter");
    await page.getByTestId("context-card").filter({ hasText: "T-02" }).first().click();
    await siehe("Zurück in die Chronologie", knopf("Zurück in die Chronologie"));
    await siehe("Nach Seite ordnen", page.getByTestId("context-strip").getByText("Nach Seite ordnen"));
  });
});

await kapitel("mitschreiben", async () => {
  await ablauf("Mitschreiben", async () => {
    await page
      .getByTestId("tl-clip")
      .filter({ hasText: /ZOOM0001/ })
      .first()
      .evaluate((b) => (b as HTMLElement).click());
    await siehe("Transkript importieren…", inspector().getByRole("button", { name: "Transkript importieren…" }));
    await siehe("Mitschreiben…", inspector().getByRole("button", { name: "Mitschreiben…" }));
    await inspector().getByRole("button", { name: "Mitschreiben…" }).click();
    const tr = page.getByTestId("transcriber");
    await tr.waitFor();
    await siehe("Tonquelle", tr.getByRole("combobox", { name: "Tonquelle" }));
    await tr.getByLabel("Neue Zeile").fill("B1: Guten Morgen.");
    await tr.getByLabel("Neue Zeile").press("Enter");
    await tr.getByTestId("line").first().waitFor();
    await tr.getByTestId("line").first().hover();
    await siehe("Zeit hierher", tr.getByTestId("line").first().getByRole("button", { name: "Zeit hierher" }));
    // Eine Zeile mit Text löschen fragt erst nach (Erste Schritte: „Wirklich löschen?“).
    await tr.getByTestId("line").first().getByRole("button", { name: "Zeile löschen" }).click();
    await siehe("Wirklich löschen?", tr.getByRole("button", { name: "Wirklich löschen?" }), {
      kapitel: "erste-schritte",
    });
    await page.keyboard.press("Tab");
    await siehe("Liste läuft mit", tr.getByText("Liste läuft mit"));
    await siehe("Andere Spuren zeigen", tr.getByText("Andere Spuren zeigen"));
    await siehe("Notizen", tr.getByTestId("notes"));
    await tr.getByRole("button", { name: "Fertig" }).click();
    await tr.waitFor({ state: "detached" });
  });

  await ablauf("Ein Transkript zu vorhandenen Zeilen importieren", async () => {
    // Wenn: schon Zeilen da sind, dann fragt der Import: hinzufügen oder ersetzen
    const vtt = join(dir, "A-01.vtt");
    writeFileSync(vtt, "WEBVTT\n\n00:00:30.000 --> 00:00:33.000\nIst hier noch frei?\n");
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
    }, vtt);
    await inspector().getByRole("button", { name: "Transkript importieren…" }).click();
    await siehe("Zur Mitschrift hinzufügen…", page.getByRole("menuitem", { name: "Zur Mitschrift hinzufügen…" }));
    await siehe("Mitschrift ersetzen…", page.getByRole("menuitem", { name: "Mitschrift ersetzen…" }));
    await page.getByRole("menuitem", { name: "Zur Mitschrift hinzufügen…" }).click();
  });
});

await kapitel("ausgeben", async () => {
  const out = await ablauf("Ausgeben", async () => {
    const out = join(dir, "Ausgabe");
    mkdirSync(out);
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
    }, out);
    await page.getByRole("tab", { name: /Ausgeben/ }).click();
    await page.getByRole("heading", { name: "Ausgeben" }).waitFor();
    for (const s of [
      "Montagevideo mit ausgeben",
      "Nach Episoden schneiden",
      "Ton aller Geräte mischen",
      "Zusätzlich eine Tonspur je Gerät",
      "Schnittliste für DaVinci Resolve",
    ])
      await siehe(s, page.getByRole("switch", { name: new RegExp(`^${esc(s)}`) }));
    await siehe("Viewer zum Ansehen im Browser", page.getByRole("switch", { name: /^Viewer zum Ansehen im Browser/ }));
    await siehe(
      "LIESMICH mit Tabelle für den Methodenteil",
      page.getByRole("switch", { name: /^LIESMICH mit Tabelle für den Methodenteil/ }),
    );
    for (const s of ["Auflösung", "Bilder je Sekunde"])
      await siehe(s, page.getByTestId("video-format").getByText(s, { exact: true }));
    for (const g of ["Montagevideo", "Nachweise im Ordner", "Für den Schnitt"])
      await siehe(g, page.getByRole("heading", { name: g, exact: true }), { hinweis: "Gruppe der Schalter" });
    await siehe("Änderungsprotokoll", page.getByRole("switch", { name: /^Änderungsprotokoll/ }));
    await siehe("Prüfsummenliste", page.getByRole("switch", { name: /^Prüfsummenliste/ }));
    // Solange der Viewer gewählt ist, lässt sich das Montagevideo nicht abwählen.
    await siehe(
      "Montagevideo bleibt mit Viewer an",
      page.getByRole("switch", { name: /^Montagevideo mit ausgeben/, disabled: true }),
      { handbuch: "bleibt **Montagevideo mit ausgeben** deshalb an" },
    );
    await siehe("Montage ansehen…");
    await siehe("Kontext", page.getByTestId("export-context"), { hinweis: "Karte Kontext links" });
    const offen = await page.getByText("Noch offen").count();
    await siehe(offen ? "Trotzdem ausgeben…" : "Ausgeben…", knopf(/^(Trotzdem a|A)usgeben…$/));
    if (offen) await siehe("Noch offen", page.getByText("Noch offen"));
    await page.getByRole("switch", { name: "Nach Episoden schneiden" }).click();
    await knopf(/^(Trotzdem a|A)usgeben…$/).click();
    const vorpruefung = knopf("Trotzdem ausgeben");
    if (await vorpruefung.isVisible().catch(() => false)) await vorpruefung.click();
    await page.getByTestId("export-result").waitFor({ timeout: 300_000 });
    await siehe("Fertig", page.getByText("Fertig.", { exact: true }));
    await siehe("Im Ordner zeigen");
    await siehe("Im Viewer ansehen");
    for (const s of ["Zeitraum", "Quellen", "Einsatztranskript", "Montage-ID"])
      await siehe(s, page.getByTestId("export-receipt-facts").getByText(s, { exact: true }));
    await siehe("Dateien anzeigen", page.getByTestId("export-files-toggle").getByText(/^\d+ Dateien anzeigen$/), {
      handbuch: "Dateien anzeigen**",
    });
    await page.getByTestId("export-files-toggle").click();
    await siehe("Ausgabeordner", page.getByTestId("export-result"));
    await siehe("LIESMICH", page.getByTestId("export-result").getByText("LIESMICH.html", { exact: true }), {
      handbuch: "`LIESMICH.html`",
    });
    await siehe(
      "manifest-sha256.txt",
      page.getByTestId("export-result").getByText("manifest-sha256.txt", { exact: true }),
      { handbuch: "`manifest-sha256.txt`" },
    );
    return out;
  });

  await ablauf("Nach einer Änderung ist die Ausgabe veraltet", async () => {
    // Wenn: danach etwas geändert wird, dann ist die Ausgabe veraltet
    await page.getByRole("tab", { name: /Durchsehen/ }).click();
    await page.getByRole("switch", { name: "Episoden bilden" }).click();
    await page.getByRole("tab", { name: /Ausgeben/ }).click();
    await siehe("Veraltet", page.getByText("Veraltet.", { exact: true }));
    await siehe("Erneut ausgeben");
    await siehe("In anderen Ordner ausgeben…");
    // Dann: auch die Übersicht kennzeichnet den Einsatz als veraltet
    await knopf("Übersicht").click();
    await siehe("Ausgabe veraltet", page.getByTestId("overview-days").getByText("Ausgabe veraltet"));
    await page.getByTestId("overview-days").getByRole("button").first().click();
  });

  await ablauf("Zurückgenommen ist die Ausgabe wieder aktuell", async () => {
    // Wenn: die Änderung zurückgenommen und Feldspur neu geladen wird, dann passt der Stand wieder zur Ausgabe
    await page.getByRole("tab", { name: /Durchsehen/ }).click();
    await page.getByRole("switch", { name: "Episoden bilden" }).click();
    await page.reload();
    await page.getByRole("tab", { name: /Ausgeben/ }).click();
    await siehe("Aktuell", page.getByText("Aktuell.", { exact: true }));
  });

  await ablauf("Die Übersicht mit den Kennwerten für den Methodenteil öffnen", async () => {
    // Wenn: die Übersicht in der linken Leiste gewählt wird
    await siehe("Übersicht");
    await knopf("Übersicht").click();
    const seite = page.getByTestId("overview");
    // Dann: steht der Einsatz mit seinem Stand da, darunter Eingang und Ausgabe mit der Montage-ID zum Kopieren
    await siehe("Feldkalender", seite.getByRole("heading", { name: "Feldkalender" }));
    await siehe("Nach Ort gruppieren", page.getByRole("switch", { name: "Nach Ort gruppieren" }));
    await siehe("Als Grafik speichern…");
    await siehe("Ausgabe aktuell", page.getByTestId("overview-days").getByText("Ausgabe aktuell"));
    // Neben dem Projektnamen; mit nur einem Einsatz heißt es dort „Ausgabe aktuell“.
    await siehe(
      "Alle Ausgaben aktuell",
      page.getByTestId("overview-all-current").getByText(/(Alle Ausgaben|Ausgabe) aktuell$/),
      {
        hinweis: "Kopf der Übersicht, bei einem Einsatz „Ausgabe aktuell“",
      },
    );
    await siehe("Kennwerte", seite.getByRole("heading", { name: "Kennwerte" }));
    const tabellen = page.getByTestId("overview-tables");
    await siehe("Eingang", tabellen.getByText(/^Eingang: Aufzeichnungen aus/));
    await siehe("Ausgabe", tabellen.getByText(/^Ausgabe: Einsatztranskript und Montagevideo/));
    await siehe("Montage-ID", tabellen.getByText(/^FS(-[0-9A-Z]{4}){3}$/), { hinweis: "Tabelle Ausgabe" });
    await siehe("Tabellen kopieren");
    await siehe("Als Markdown kopieren");
    // Wenn: in die Achse des Einsatzes geklickt wird, dann ist der Einsatz in Durchsehen offen
    await page.getByTestId("overview-strip").first().click();
    await page.getByRole("tab", { name: /Durchsehen/, selected: true }).waitFor();
    // Wenn: über die Übersicht der Name des Einsatzes gewählt wird, dann ist der Einsatz wieder offen
    await knopf("Übersicht").click();
    await page.getByTestId("overview-days").getByRole("button").first().click();
    await page.getByRole("tab", { name: /Ausgeben/ }).click();
  });

  await ablauf("Den Viewer im Browser öffnen", async () => {
    // Wenn: die HTML-Datei im Chromium von Electron geöffnet wird
    const html = readdirSync(out, { recursive: true })
      .map(String)
      .find((f) => f.endsWith(".html"));
    if (!html) throw new Error("kein Viewer ausgegeben");
    const [viewer] = await Promise.all([
      app.waitForEvent("window"),
      app.evaluate(
        ({ BrowserWindow }, p) => void new BrowserWindow({ width: 1440, height: 900 }).loadFile(p),
        join(out, html),
      ),
    ]);
    await viewer.waitForLoadState();
    const haupt = page;
    page = viewer;
    // „Alles“ erscheint erst, wenn die Zeitleiste vergrößert ist.
    await viewer.getByRole("button", { name: "Zeitleiste vergrößern" }).click();
    for (const b of [
      "Text läuft mit",
      "Alles",
      "Ansicht",
      "Kontext",
      "Stelle kopieren",
      "Erweiterte Tonspurkontrolle",
    ]) {
      const n = new RegExp(`^(K)?${b}`);
      await siehe(
        b,
        viewer
          .getByRole("button", { name: n })
          .or(viewer.getByRole("switch", { name: n }))
          .or(viewer.getByText(b, { exact: true })),
      );
    }
    await siehe("Montage-ID", viewer.locator("#facts dd").filter({ hasText: /^FS(-[0-9A-Z]{4}){3} · / }), {
      hinweis: "Angaben unter dem Video, Zeile Montage",
    });
    await viewer.getByRole("button", { name: "Erweiterte Tonspurkontrolle" }).click();
    await viewer.locator("#ton-next").click();
    await siehe("Video freigeben…", viewer.getByRole("button", { name: "Video freigeben…" }));
    page = haupt;
  });

  await ablauf("Angaben zum Datensatz eintragen und Metadaten wählen", async () => {
    // Wenn: in der Übersicht ein Titel für den Datensatz eingetragen und gespeichert wird
    await knopf("Übersicht").click();
    const karte = page.getByTestId("dataset-card");
    await siehe("Angaben zum Datensatz", karte.getByRole("heading", { name: "Angaben zum Datensatz" }), {
      handbuch: "### Angaben zum Datensatz",
    });
    for (const feld of ["Titel des Datensatzes", "Mitwirkende", "Beschreibung", "Schlagworte", "Lizenz", "Zugang"])
      await siehe(feld, karte.getByLabel(new RegExp(`^${esc(feld)}`)));
    await siehe("Urheber*innen", karte.getByLabel(/^Urheber\*innen/), { handbuch: "**Urheber\\*innen**" });
    await siehe("Gehört zu", karte.getByLabel(/^Gehört zu/));
    for (const gruppe of ["Inhalt", "Personen", "Nutzung"])
      await siehe(gruppe, karte.getByRole("heading", { name: gruppe, exact: true }));
    await siehe("Person hinzufügen", karte.getByRole("button", { name: "Person hinzufügen" }));
    await karte.getByLabel(/^Titel des Datensatzes/).fill("Marktstudie");
    await siehe("Speichern", karte.getByRole("button", { name: "Speichern" }));
    await karte.getByRole("button", { name: "Speichern" }).click();
    // Dann: meldet die Karte „Gespeichert“, und der Zugang bleibt ohne Vorgabe
    await karte.getByText("Gespeichert").waitFor();
    if (await karte.getByLabel(/^Zugang/).inputValue()) throw new Error("Zugang ist vorbelegt");
    // Wenn: der Einsatz geöffnet wird, dann zeigen seine Einsatzdaten den Titel des Projekts als Vorgabe
    await page.getByTestId("overview-days").getByRole("button").first().click();
    await knopf("Einsatzdaten bearbeiten…").click();
    const details = page.getByTestId("session-details");
    await siehe(
      "Angaben zum Datensatz für diesen Einsatz",
      details.getByText("Angaben zum Datensatz für diesen Einsatz"),
    );
    await details.getByText("Angaben zum Datensatz für diesen Einsatz").click();
    const vorgabe = await details.getByLabel(/^Titel des Datensatzes/).getAttribute("placeholder");
    if (vorgabe !== "Marktstudie") throw new Error(`Vorgabe im Einsatz: ${vorgabe}`);
    await schliessen();
    // Wenn: im Schritt Ausgeben nachgesehen wird, dann gibt es den Schalter für die Metadaten, ohne Vorauswahl
    await page.getByRole("tab", { name: /Ausgeben/ }).click();
    const schalter = page.getByRole("switch", { name: "Metadaten (RO-Crate, .json)" });
    await siehe("Metadaten (RO-Crate, .json)", schalter);
    if ((await schalter.getAttribute("aria-checked")) === "true") throw new Error("Metadaten sind vorgewählt");
    // Zum Schluss: Titel wieder leeren, damit die Ausgabe für die nächsten Kapitel aktuell bleibt
    await knopf("Übersicht").click();
    await karte.getByLabel(/^Titel des Datensatzes/).fill("");
    await karte.getByRole("button", { name: "Speichern" }).click();
    await karte.getByText("Gespeichert").waitFor();
    await page.getByTestId("overview-days").getByRole("button").first().click();
  });
});

await kapitel("einsammeln", async () => {
  await ablauf("Verschobene Originale suchen", async () => {
    // Wenn: die Originale verschoben werden, dann steht ein Hinweis unter den Schritten,
    // und der Dialog zeigt Zustand und Knöpfe
    const { renameSync } = await import("node:fs");
    renameSync(quellen, `${quellen}-verschoben`);
    await page.reload();
    await siehe(
      "Feldspur findet … Originaldateien nicht.",
      page.getByText(/^Feldspur findet \d+ Originaldateien nicht\.$/),
      {
        handbuch: "Originaldateien nicht.“**",
        hinweis: "Hinweis unter den Schritten",
      },
    );
    await siehe("Originale suchen…");
    await knopf("Originale suchen…").click();
    const dlg = page.getByTestId("originals-dialog");
    await siehe("Ordner durchsuchen…", dlg.getByRole("button", { name: "Ordner durchsuchen…" }));
    await siehe("Datei wählen…", dlg.getByRole("button", { name: "Datei wählen…" }).first());
    await siehe("Alle Prüfsummen prüfen", dlg.getByRole("button", { name: "Alle Prüfsummen prüfen" }));
    await schliessen();
    renameSync(`${quellen}-verschoben`, quellen);
  });

  await ablauf("Lange Dateilisten scrollen in der Karte", async () => {
    // Angenommen: ein Gerät hat so viele Fotos ohne Zeitangabe, dass seine Liste in der Karte scrollt
    // (verschiedene Farben, sonst gelten die Dateien als Doppel)
    const viele = join(dir, "Viele Fotos");
    mkdirSync(viele);
    for (let i = 1; i <= 14; i++)
      makePhoto(join(viele, `Markt-${String(i).padStart(2, "0")}.jpg`), `0x${(0x406080 + i * 0x0b0503).toString(16)}`);
    await page.evaluate(async ([id, p]) => window.feldspur.importPaths(id!, [p!]), [sessionId, viele]);
    await page.reload();
    await page.getByRole("tab", { name: /Einsammeln/ }).click();
    await src("Markt-01.jpg").waitFor({ timeout: 30_000 });
    // Dann: die Fußzeile nennt, was noch ohne Zeit ist
    const fuss = page.getByTestId("source-list-footer").filter({ hasText: "ohne Zeit" }).first();
    await siehe("ohne Zeit", fuss.getByRole("button", { name: /ohne Zeit$/ }));
  });
});

// Zuletzt, weil beides den Stand der Ausgabe und des Feldkalenders verändert.
await kapitel("ausgeben", async () => {
  await ablauf("Die Übersicht meldet eine Ausgabe, die im Ordner fehlt", async () => {
    // Wenn: der Ausgabeordner verschoben wird, dann steht am Einsatz, dass die Ausgabe fehlt
    const { renameSync } = await import("node:fs");
    const ausgabe = join(dir, "Ausgabe");
    renameSync(ausgabe, `${ausgabe}-verschoben`);
    await page.reload();
    await knopf("Übersicht").click();
    await siehe("Ausgabe fehlt im Ordner", page.getByTestId("overview-days").getByText("Ausgabe fehlt im Ordner"));
    renameSync(`${ausgabe}-verschoben`, ausgabe);
  });

  await ablauf("Eine Quelle weit weg vom Datum fehlt im Feldkalender", async () => {
    // Angenommen: die Uhr einer Kamera ist auf 2019 zurückgesprungen
    const weit = join(dir, "Falsche Uhr");
    mkdirSync(weit);
    makePhoto(join(weit, "IMG_20190314_120000.jpg"), "0x8a1f70");
    await page.evaluate(async ([id, p]) => window.feldspur.importPaths(id!, [p!]), [sessionId, weit]);
    await page.reload();
    await knopf("Übersicht").click();
    // Dann: die Zeile des Einsatzes nennt die Quelle, und „Abgleichen“ führt zum Einsatz
    const tage = page.getByTestId("overview-days");
    await siehe("1 Quelle weit weg vom Datum", tage.getByText("1 Quelle weit weg vom Datum"));
    await siehe("Abgleichen", tage.getByRole("button", { name: /^Abgleichen/ }));
    await tage
      .getByRole("button", { name: /^Abgleichen/ })
      .first()
      .click();
    await page.getByRole("tab", { name: /Abgleichen/, selected: true }).waitFor();
  });
});

await app.close();

const fehler = befunde.filter((b) => !b.imHandbuch || !b.inApp);
const zeilen = befunde.map(
  (b) => `| ${b.kapitel} | ${b.begriff} | ${b.imHandbuch ? "✓" : "✗"} | ${b.inApp ? "✓" : "✗"} | ${b.hinweis ?? ""} |`,
);
const bericht = [
  `# Handbuch-Rundgang`,
  "",
  `${befunde.length} Prüfungen, ${fehler.length} Abweichungen, ${abbrueche.length} Kapitel abgebrochen.`,
  "",
  "| Kapitel | Begriff | Handbuch | App | Hinweis |",
  "|---|---|---|---|---|",
  ...zeilen,
  ...(abbrueche.length ? ["", "## Abgebrochen", "", ...abbrueche.map((a) => `- ${a}`)] : []),
].join("\n");
if (process.env.FELDSPUR_HANDBUCH_BERICHT) writeFileSync(process.env.FELDSPUR_HANDBUCH_BERICHT, bericht);
console.log(`\n${befunde.length} Prüfungen, ${fehler.length} Abweichungen, ${abbrueche.length} Abbrüche`);
for (const f of fehler)
  console.log(
    `  ✗ ${f.kapitel}: ${f.begriff}${f.imHandbuch ? "" : " – nicht im Handbuch"}${f.inApp ? "" : " – nicht in der App"}`,
  );
for (const a of abbrueche) console.log(`  ! ${a}`);
if (fehler.length || abbrueche.length) process.exit(1);
console.log("Handbuch-Rundgang ok");
