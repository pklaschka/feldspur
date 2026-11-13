/**
 * Rauchtest der Desktop-App: startet Electron mit einem frischen Projekt,
 * legt einen Einsatz an, importiert erfundene Fixtures und geht die vier Schritte durch.
 *
 *   vp run e2e                                     (Linux ohne Bildschirm: xvfb-run -a …)
 *   FELDSPUR_SCREENSHOT=bild.png …                 speichert ein Bildschirmfoto
 *   FELDSPUR_E2E_APP=release/…/feldspur vpx test/smoke.e2e.ts   prüft das fertige Paket
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";
import {
  makeDiaryPage,
  makePdf,
  makePhoto,
  makeSyncAudio,
  makeSyncDay,
} from "../../../packages/media/test/fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "feldspur-e2e-"));
const fixtures = join(dir, "Rohquellen");
makeSyncDay(fixtures);
makePhoto(join(fixtures, "IMG_0231.jpg"), "0x8a4fbf", {
  make: "Beispiel",
  model: "Handy Testperson A",
  dateTimeOriginal: "2026:09:14 10:12:34",
});
makePhoto(join(fixtures, "IMG_20260914_104050.jpg"), "0x1f8a70");
makeDiaryPage(join(fixtures, "Tagebuch_S01.jpg"), 1);
makeDiaryPage(join(fixtures, "Tagebuch_S02.jpg"), 2);
makePhoto(join(fixtures, "Marktstand.jpg"), "0x2a52be"); // ohne jede Zeitangabe
const sources = process.env.FELDSPUR_E2E_SOURCES ?? fixtures;
// Nachtrag: Folgeaufnahme ohne eigene Zeit, zweites Foto einer Tagebuchseite, PDF-Scan, versehentliche Datei.
const later = join(dir, "Nachtrag");
mkdirSync(later, { recursive: true });
makeSyncAudio(join(later, "ZOOM0002.m4a"), { seconds: 40, talk: [[0, 20]] });
makeDiaryPage(join(later, "Tagebuch_S02_Rueckseite.jpg"), 3);
makePdf(join(later, "Feldnotizen_Scan.pdf"), [
  ["Feldnotizen (erfundenes Beispiel)", "", "10:50  Testperson C kommt dazu", "10:58  Regen hoert auf"],
  ["Seite 2", "", "11:05  Abbau beginnt"],
]);
writeFileSync(join(later, "Einkaufsliste.txt"), "Milch, Brot\n");

// FELDSPUR_E2E_APP=<Programmdatei> prüft statt des Entwicklungsstands das fertige Paket.
const packaged = process.env.FELDSPUR_E2E_APP;
const sandbox = process.env.CI || process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const app = await electron.launch(
  packaged
    ? { executablePath: packaged, args: [join(dir, "Test.feldspur"), ...sandbox] }
    : { args: [".", join(dir, "Test.feldspur"), ...sandbox], cwd: join(import.meta.dirname, "..") },
);
let failed = false;
const page = await app.firstWindow();
const logs: string[] = [];
page.on("console", (m) => m.type() === "error" && logs.push(m.text()));
try {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByText("+ neuer Einsatz").click();
  await page.getByLabel("Titel").fill("Testmarkt");
  await page.getByLabel("Datum").fill("2026-09-14");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await page.getByRole("heading", { name: "Testmarkt" }).waitFor();

  // Drag & Drop lässt sich nicht mit echten Dateipfaden simulieren; derselbe Weg über die API:
  const sessionId = await page.evaluate(async () => (await window.feldspur.currentProject())!.sessions[0]!.id);
  await page.evaluate(async ([id, p]) => window.feldspur.importPaths(id!, [p!]), [sessionId, sources]);
  await page.reload();
  await page
    .getByText(/ZOOM000\d\.m4a/)
    .first()
    .waitFor();

  const shot = async (suffix: string) => {
    if (!process.env.FELDSPUR_SCREENSHOT) return;
    await page.waitForTimeout(150);
    await page.screenshot({ path: process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, `${suffix}.png`) });
  };

  // 1 Einsammeln: Gerätekarten mit sprechenden Namen.
  await page.getByRole("tab", { name: /Einsammeln/ }).click();
  await page.getByTestId("device-card").first().waitFor();
  const deviceNames = await page.getByTestId("device-name").allInnerTexts();
  console.log(`Geräte: ${deviceNames.join(" | ")}`);
  const camera = page.getByTestId("device-card").filter({ hasText: /C00(01|12)\.MP4/ });
  await camera.getByTestId("device-name").click();
  await camera.getByLabel(/^Name für/).fill("Kamera Stativ");
  await camera.getByLabel(/^Name für/).press("Enter");
  await page.getByTestId("device-name").filter({ hasText: "Kamera Stativ" }).waitFor();
  await page.getByTestId("source").filter({ hasText: "IMG_0231.jpg" }).click();
  await page.getByTestId("inspector").getByText("10:12:34").first().waitFor();
  await shot("-einsammeln");

  // 2 Abgleichen: Audiorekorder als Referenz, Handy von Hand, Kamera über das Klatschen.
  await page.getByRole("tab", { name: /Abgleichen/ }).click();
  await page.locator('[data-testid=clock][data-device*="ZOOM"]').getByRole("button", { name: "als Referenz" }).click();
  await page
    .locator('[data-testid=clock][data-device*="ZOOM"] [data-testid=clock-value]')
    .getByText("Referenzuhr")
    .waitFor();
  await page.getByLabel(/Abweichung .*Handy/).fill("+0:04");
  await page.getByLabel(/Abweichung .*Handy/).press("Enter");
  await page
    .locator('[data-testid=clock][data-device*="Handy"] [data-testid=clock-value]')
    .getByText("von Hand")
    .waitFor();
  await page.getByRole("button", { name: "Tonspuren abgleichen" }).click();
  const proposal = page.getByTestId("proposal").first();
  await proposal.waitFor({ timeout: 60_000 });
  const proposalText = await proposal.innerText();
  console.log(`Vorschlag: ${proposalText.replace(/\s+/g, " ")}`);
  if (!proposalText.includes("+2:47")) throw new Error("Vorschlag nennt nicht +2:47");
  await shot("-abgleich");
  await proposal.getByRole("button", { name: "Übernehmen" }).click();
  await page
    .locator('[data-testid=clock][data-device="Kamera Stativ"] [data-testid=clock-value]')
    .getByText("über Anker")
    .waitFor();

  // Anker von Hand: A-01 bei 9:00 ist derselbe Moment wie das Foto mit Zeit im Dateinamen.
  const pick = async (label: string, option: RegExp) => {
    await page.getByRole("combobox", { name: label }).click();
    await page.getByRole("option", { name: option }).click();
  };
  await pick("Erste Aufnahme", /A-01/);
  await page.getByLabel("Erste Aufnahme, Stelle").fill("9:00");
  await pick("Zweite Aufnahme", /IMG_20260914_104050/);
  await page.getByLabel("Notiz zum Anker").fill("Glocke");
  await page.getByRole("button", { name: "Anker setzen" }).click();
  await page.getByTestId("anchor-list").getByText("Glocke").waitFor();
  const fotoClock = page.locator('[data-testid=clock][data-device="Fotos IMG"] [data-testid=clock-value]');
  await fotoClock.getByText("über Anker").waitFor();
  await shot("-anker");
  await page
    .getByTestId("anchor-list")
    .locator("li", { hasText: "Glocke" })
    .getByRole("button", { name: "löschen" })
    .click();
  await fotoClock.getByText("offen").waitFor();

  // 3 Durchsehen: Zeitachse mit Episoden; Kamera liegt jetzt bei 10:16:00.
  await page.getByRole("tab", { name: /Durchsehen/ }).click();
  await page.getByTestId("episode").first().waitFor({ state: "attached" });
  console.log(`Episoden: ${(await page.getByTestId("episode").allTextContents()).join(", ")}`);
  await page
    .getByTestId("tl-clip")
    .filter({ hasText: /C00(01|12)\.MP4/ })
    .first()
    .evaluate((b) => (b as HTMLElement).click());
  await page
    .getByTestId("inspector")
    .getByText(/^10:16:00/)
    .waitFor();

  // Randnotiz auf der ersten Tagebuchseite: 10:12, Bezug reicht 15 Min. zurück.
  await page.getByTestId("tray-item").filter({ hasText: "Tagebuch_S01.jpg" }).click();
  await page.getByLabel("Randnotiz T-01").fill("10:12");
  await page.getByLabel("Randnotiz T-01").press("Enter");
  await page.getByTestId("tl-diary").first().waitFor({ state: "attached" });
  await page.getByTestId("inspector").getByText("09:57:00 – 10:12:00").waitFor();
  const tracks = await page
    .getByTestId("track")
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.device));
  console.log(`Spuren: ${tracks.join(" | ")}`);
  if (tracks.length < 4) throw new Error(`Erwartet mindestens 4 Spuren, gefunden ${tracks.length}`);
  await shot("");
  // Tagebuch abtippen: Seite 1 trägt schon die Randnotiz, auf Seite 2 zwei Einträge als Rahmen ziehen.
  await page.getByTestId("inspector").getByRole("button", { name: "Abtippen…" }).click();
  const editor = page.getByTestId("diary-editor");
  await editor.waitFor();
  // Die Randnotiz hat nur einen Scan-Eintrag angelegt; auf Kurzform umstellen.
  await editor.getByRole("radio", { name: "Kurzform" }).click();
  await editor.getByLabel("Kurzform Eintrag 1").fill("Ankunft, Aufbau der Stände, Regen");
  await editor.getByLabel("Kurzform Eintrag 1").blur();
  await editor.getByRole("navigation", { name: "Seiten" }).getByRole("button").nth(1).click();
  const sheet = editor.getByTestId("diary-page");
  await sheet.locator("img").waitFor();
  const drag = async (x0: number, y0: number, x1: number, y1: number) => {
    const b = (await sheet.boundingBox())!;
    await page.mouse.move(b.x + b.width * x0, b.y + b.height * y0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 6 });
    await page.mouse.up();
  };
  await drag(0.06, 0.08, 0.94, 0.42);
  await editor.getByLabel("Notierzeit Eintrag 2").waitFor();
  await drag(0.06, 0.46, 0.94, 0.8);
  await editor.getByLabel("Notierzeit Eintrag 3").waitFor();
  for (const [n, at, text] of [
    [2, "10:35", "Streit am Käsestand, Händlerin holt Marktaufsicht"],
    [3, "10:41", "Gespräch mit Testperson B über Standgebühren"],
  ] as const) {
    await editor.getByLabel(`Notierzeit Eintrag ${n}`).fill(at);
    await editor.getByLabel(`Notierzeit Eintrag ${n}`).press("Enter");
    await editor.getByLabel(`Kurzform Eintrag ${n}`).fill(text);
    await editor.getByLabel(`Kurzform Eintrag ${n}`).blur();
  }
  await editor.getByText("10:26–10:41").waitFor();
  await shot("-tagebuch");
  await editor.getByRole("button", { name: "Fertig" }).click();
  await editor.waitFor({ state: "detached" });
  const diaryItems = await page.getByTestId("tl-diary").count();
  console.log(`Tagebucheinträge auf der Zeitachse: ${diaryItems}`);
  if (diaryItems < 3) throw new Error(`Erwartet 3 Tagebucheinträge, gefunden ${diaryItems}`);
  // Foto ohne Zeit: Uhrzeit von Hand eintragen, Beleg ab- und wieder einschalten.
  await page.getByTestId("tray-item").filter({ hasText: "Marktstand.jpg" }).click();
  const form = page.getByTestId("time-form");
  await form.getByLabel("Uhrzeit").fill("10:30");
  await form.getByRole("radio", { name: "ungefähr" }).click();
  await form.getByLabel("Notiz").fill("geschätzt");
  await form.getByRole("button", { name: "Eintragen" }).click();
  await page
    .getByTestId("inspector")
    .getByText(/^10:30:00/)
    .waitFor();
  await page.getByTestId("inspector").getByText("Von Hand: geschätzt").waitFor();
  const sw = page.getByRole("switch", { name: /Von Hand: geschätzt/ });
  await sw.click();
  await page.getByTestId("tray-item").filter({ hasText: "Marktstand.jpg" }).waitFor();
  await sw.click();
  await page.getByTestId("tl-point").filter({ hasText: "Marktstand.jpg" }).waitFor({ state: "attached" });
  await shot("-von-hand");

  // Treffersuche auf der Leinwand: Klick in die Tagebuchspur (letzte Spur) mitten in den Bezugszeitraum.
  await page.getByRole("button", { name: "Schließen" }).click();
  const box = (await page.locator("canvas").boundingBox())!;
  const rangeText = await page
    .getByText(/^\d\d:\d\d – \d\d:\d\d/)
    .first()
    .innerText();
  const [from, to] = rangeText.match(/\d\d:\d\d/g)!.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  const xAt = (min: number) => box.x + ((min - from!) / (to! - from!)) * box.width;
  await page.mouse.click(xAt(10 * 60 + 5), box.y + 30 + 40 + (tracks.length - 1) * 52 + 26);
  await page.getByTestId("inspector").getByText("Tagebuch_S01.jpg").first().waitFor();
  await page.getByRole("button", { name: "Schließen" }).click();
  // Klick in die Tonspur spult den Player dorthin: 10:16:20 ist im Rekorder 1:20.
  await page.mouse.click(xAt(10 * 60 + 16 + 1 / 3), box.y + 30 + 40 + 26);
  const pos = page.getByTestId("player-position");
  await pos.waitFor();
  const posText = await pos.innerText();
  console.log(`Wiedergabe: ${posText.replace(/\s+/g, " ")}`);
  if (!/^1:(1[5-9]|2[0-5])/.test(posText)) throw new Error(`Player steht nicht bei etwa 1:20: ${posText}`);
  // Daraus eine angesagte Uhrzeit vorbereiten (nur Formular, nicht speichern).
  await page.getByRole("button", { name: /Uhrzeit eintragen/ }).click();
  await page.getByRole("button", { name: /Wiedergabestelle .* übernehmen/ }).click();
  const atValue = await page.getByLabel("Stelle in der Aufnahme").inputValue();
  if (!atValue.startsWith("1:")) throw new Error(`Stelle nicht übernommen: ${atValue}`);
  await shot("-wiedergabe");
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await page.getByRole("button", { name: "Schließen" }).click();
  await page.mouse.move(xAt(10 * 60 + 16), box.y + 30 + 40 + 26);
  await shot("-durchsehen");
  await page.getByRole("tab", { name: /Ausgeben/ }).click();
  await page.getByRole("heading", { name: "Ausgeben" }).waitFor();
  await shot("-ausgeben");

  // Quellen pflegen: Nachtrag einsammeln, Versehen entfernen, Seiten zusammenführen, Folgeaufnahme anhängen.
  await page.evaluate(async ([id, p]) => window.feldspur.importPaths(id!, [p!]), [sessionId, later]);
  await page.reload();
  await page.getByRole("tab", { name: /Einsammeln/ }).click();
  const src = (name: string) => page.getByTestId("source").filter({ hasText: name });
  await src("Einkaufsliste.txt").waitFor();
  const menuFor = async (name: string) => {
    const label = (await src(name).getAttribute("data-label"))!;
    await page
      .getByRole("button", { name: `Aktionen für ${label}`, exact: true })
      .first()
      .click();
    return label;
  };
  await menuFor("Einkaufsliste.txt");
  await page.getByRole("menuitem", { name: "Aus Projekt entfernen…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Entfernen" }).click();
  await src("Einkaufsliste.txt").waitFor({ state: "detached" });

  await menuFor("Tagebuch_S02_Rueckseite.jpg");
  await page.getByRole("menuitem", { name: /Als weiteres Bild zu Seite/ }).click();
  await page.getByRole("menuitem", { name: /Tagebuch_S02\.jpg/ }).click();
  await page
    .getByText(/weiteres Bild zu T-\d+/)
    .first()
    .waitFor();

  const zoomLabel = await menuFor("ZOOM0002.m4a");
  await page.getByRole("menuitem", { name: /Setzt Aufnahme fort/ }).click();
  await page.getByRole("menuitem", { name: /ZOOM0001\.m4a/ }).click();
  await page.getByText(/setzt A-\d+ fort/).waitFor();
  await src("ZOOM0002.m4a").click();
  await page
    .getByTestId("inspector")
    .getByText(/^10:25:00/)
    .first()
    .waitFor();
  console.log(`Folgeaufnahme ${zoomLabel} beginnt 10:25:00`);
  await shot("-quellen");

  // Mitschreiben: A-01 bei etwa 1:00 (10:16:00) abhören und zwei Zeilen tippen.
  await src("ZOOM0001.m4a").click();
  await page.getByTestId("inspector").getByRole("button", { name: "Mitschreiben…" }).click();
  const tr = page.getByTestId("transcriber");
  await tr.waitFor();
  await tr
    .getByTestId("event")
    .filter({ hasText: /V-\d+ \(Video\) beginnt/ })
    .first()
    .waitFor();
  const scrub = tr.getByRole("slider", { name: "Stelle in der Aufnahme" });
  const sb = (await scrub.boundingBox())!;
  await page.mouse.click(sb.x + sb.width * 0.1, sb.y + sb.height / 2);
  await tr
    .getByTestId("transcriber-position")
    .getByText(/^(0:59|1:0)/)
    .waitFor();
  const newLine = tr.getByLabel("Neue Zeile");
  await newLine.fill("B1: Wie lange stehen Sie schon hier?");
  await newLine.press("Enter");
  await tr.getByTestId("line").first().waitFor();
  if ((await tr.getByLabel("Sprecher", { exact: true }).inputValue()) !== "B1")
    throw new Error("Sprecher nicht übernommen");
  await page.mouse.click(sb.x + sb.width * 0.105, sb.y + sb.height / 2);
  await newLine.fill("H: Zwölf Jahre, seit mein Vater aufgehört hat.");
  await newLine.press("Enter");
  await tr.getByTestId("line").nth(1).waitFor();
  const firstLine = await tr.getByTestId("line").first().innerText();
  console.log(`Mitschrift: ${firstLine.replace(/\s+/g, " ")}`);
  if (!/10:1(5:59|6:0\d)/.test(firstLine)) throw new Error(`Erste Zeile nicht bei etwa 10:16:00: ${firstLine}`);
  // Esc schaltet die Wiedergabe um und schließt den Dialog nicht.
  await newLine.press("Escape");
  await newLine.press("Escape");
  await tr.waitFor();
  await shot("-mitschreiben");
  await tr.getByRole("button", { name: "Fertig" }).click();
  await tr.waitFor({ state: "detached" });
  await page.getByTestId("transcript-summary").getByText("2 Zeilen").waitFor();

  // Automatisches Transkript (erfundenes Whisper-VTT) dazuholen.
  const vtt = join(dir, "A-01.vtt");
  writeFileSync(
    vtt,
    "WEBVTT\n\n00:00:30.000 --> 00:00:33.000\n<v SPEAKER_00>Ist hier noch frei?\n\n00:01:10.000 --> 00:01:12.000\n<v SPEAKER_01>Ja.\n",
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
  }, vtt);
  await page.getByTestId("inspector").getByRole("button", { name: "Transkript importieren…" }).click();
  await page.getByRole("menuitem", { name: "Zur Mitschrift hinzufügen …" }).click();
  await page.getByTestId("inspector").getByRole("status").getByText("2 Zeilen übernommen").waitFor();
  await page.getByTestId("transcript-summary").getByText("4 Zeilen").waitFor();

  // Schnellsuche (Strg+K) findet die importierte Zeile und springt hin.
  await page.keyboard.press("Control+k");
  const searchBox = page.getByTestId("search").getByRole("textbox", { name: "Suchen" });
  await searchBox.fill("noch frei");
  await page.getByTestId("search").getByRole("option").first().getByText("noch frei").waitFor();
  await shot("-suche");
  await searchBox.press("Enter");
  await page.getByTestId("search").waitFor({ state: "detached" });
  await page.getByRole("tab", { name: /Durchsehen/, selected: true }).waitFor();

  // Seitenleiste breiter ziehen; die Breite bleibt nach dem Neuladen.
  const inspectorBox = async () => (await page.getByTestId("inspector").boundingBox())!;
  const before0 = await inspectorBox();
  const grip = (await page.getByRole("separator", { name: "Breite der Seitenleiste" }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 300);
  await page.mouse.down();
  await page.mouse.move(grip.x - 120, grip.y + 300, { steps: 5 });
  await page.mouse.up();
  const after0 = await inspectorBox();
  if (Math.abs(after0.width - before0.width - 120) > 4)
    throw new Error(`Seitenleiste nicht verbreitert: ${before0.width} → ${after0.width}`);

  await page.getByRole("tab", { name: /Einsammeln/ }).click();

  // Große Vorschau und PDF.
  await src("Feldnotizen_Scan.pdf").click();
  await page.getByRole("button", { name: "Feldnotizen_Scan.pdf groß ansehen" }).click();
  const preview = page.getByTestId("preview");
  await preview.getByText("Seite 2").waitFor();
  await preview.locator("canvas").nth(1).waitFor();
  await shot("-vorschau-pdf");
  await preview.getByRole("button", { name: "Schließen" }).click();
  await preview.waitFor({ state: "detached" });
  await src("Tagebuch_S02.jpg").click();
  await page.getByRole("button", { name: "Tagebuch_S02.jpg groß ansehen" }).click();
  await preview.getByText("Bild 1 von 2").waitFor();
  await preview.getByRole("button", { name: "Nächstes Bild" }).click();
  await preview.getByText("Tagebuch_S02_Rueckseite.jpg").waitFor();
  await shot("-vorschau");
  await preview.getByRole("button", { name: "Schließen" }).click();

  // Abtippen: PDF-Seiten einzeln, Vorder- und Rückseite gemeinsam.
  await src("Feldnotizen_Scan.pdf").click();
  await page.getByTestId("inspector").getByRole("button", { name: "Abtippen…" }).click();
  await editor.waitFor();
  const nav = editor.getByRole("navigation", { name: "Seiten" });
  await nav.getByText(/S\. 2$/).waitFor();
  await editor.getByTestId("diary-page").locator("canvas").waitFor();
  await drag(0.06, 0.12, 0.94, 0.3);
  await editor.getByLabel("Notierzeit Eintrag 4").fill("10:58");
  await editor.getByLabel("Notierzeit Eintrag 4").press("Enter");
  await editor.getByText("T-03 S. 1").first().waitFor();
  await nav.getByRole("button", { name: /2 Bilder/ }).click();
  await editor.getByTestId("diary-page").nth(1).waitFor();
  await shot("-tagebuch-seiten");
  await editor.getByRole("button", { name: "Fertig" }).click();
  await editor.waitFor({ state: "detached" });

  // Einsatzdaten bearbeiten.
  await page.getByRole("button", { name: "Einsatzdaten bearbeiten" }).click();
  const details = page.getByTestId("session-details");
  await details.getByLabel("Ort", { exact: true }).fill("Südstadt");
  await details.getByRole("button", { name: "+ Feld" }).click();
  await details.getByLabel("Feld", { exact: true }).fill("DOI");
  await details.getByLabel("Wert für DOI").fill("10.0000/beispiel");
  await shot("-einsatzdaten");
  await details.getByRole("button", { name: "Speichern" }).click();
  await details.waitFor({ state: "detached" });
  await page.locator("main header").getByText("Südstadt").waitFor();
  // Zeitzone je Gerät im Gerätemenü.
  await page.getByRole("tab", { name: /Einsammeln/ }).click();
  const camMenu = page.getByRole("button", { name: "Aktionen für Gerät Kamera Stativ" });
  await camMenu.click();
  await page.getByRole("menuitemradio", { name: "UTC", exact: true }).click();
  await camMenu.click();
  await page
    .getByRole("menuitemradio", { name: "UTC", exact: true })
    .and(page.locator('[aria-checked="true"]'))
    .waitFor();
  await shot("-geraetemenue");
  await page.getByRole("menuitemradio", { name: /^Wie der Einsatz/ }).click();

  // Ausgeben: Ordnerwahl ersetzen, Video mit Einblendungen aus der Oberfläche.
  const out = join(dir, "Ausgabe");
  mkdirSync(out);
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog;
  }, out);
  await page.getByRole("tab", { name: /Ausgeben/ }).click();
  const scaffold = page.getByTestId("scaffold-preview");
  await scaffold
    .getByText(/#00:00:00-0# .*Zwischentafel|#00:00:00-0# .*Episode 1/)
    .first()
    .waitFor();
  console.log(`Zeitgerüst: ${await scaffold.locator("li").count()} Zeilen`);
  await shot("-ausgeben");

  // Montage in der App ansehen: springt ins erste Episodenstück und spielt ab.
  await page.getByRole("button", { name: "Montage ansehen" }).click();
  const montage = page.getByTestId("montage");
  const montageTime = montage.getByTestId("montage-time");
  await montageTime.waitFor();
  const montageBar = montage.getByTestId("montage-bar");
  for (let i = 0; i < 8 && !(await montageBar.innerText()).includes("Episode"); i++)
    await montage.getByRole("button", { name: "Nächstes Stück" }).click();
  const before = await montageTime.innerText();
  await montage.getByRole("button", { name: "Abspielen" }).click();
  // In der Episode laufen die Originale (Ton oder Video) an der passenden Stelle mit.
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLMediaElement>("[data-testid=montage] :is(video, audio)")].some(
      (m) => !m.paused && m.currentTime > 0.5,
    ),
  );
  console.log(`Montage-Vorschau: ${before} → ${await montageTime.innerText()} · ${await montageBar.innerText()}`);
  // Eine Minute weiter (←/→ springen je 10 s) läuft die Kamera: Ihr Bild steht im Hauptfeld.
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => {
    const v = document.querySelector<HTMLVideoElement>("[data-testid=montage] video");
    return !!v && !v.paused && v.currentTime > 0.2 && v.readyState >= 2;
  });
  await shot("-montage");
  await montage.getByRole("button", { name: "Pause" }).click();
  // Tagebucheintrag: Scan-Ausschnitt groß, dazu der abgetippte Text.
  await page.keyboard.press("Home");
  for (let i = 0; i < 12 && !(await montageBar.innerText()).includes("Tagebuch"); i++)
    await montage.getByRole("button", { name: "Nächstes Stück" }).click();
  await montage.locator("canvas[aria-label^='Tagebuch']").waitFor();
  await shot("-montage-tagebuch");
  await montage.getByRole("button", { name: "Schließen" }).click();
  await montage.waitFor({ state: "detached" });
  const t0 = Date.now();
  await page.getByRole("switch", { name: "Schnittliste für DaVinci Resolve" }).click();
  await page.getByRole("button", { name: "Ausgeben…" }).click();
  // Während der Ausgabe den Reiter wechseln: Sie läuft weiter, der Reiter zeigt den Fortschritt.
  await page.getByTestId("export-progress").waitFor();
  await page.getByRole("tab", { name: /Durchsehen/ }).click();
  await page.getByRole("tab", { name: /Ausgeben.*läuft/ }).waitFor();
  await page.getByRole("tab", { name: /Ausgeben/ }).click();
  await page.getByTestId("export-result").waitFor({ timeout: 300_000 });
  const files = await page.getByTestId("export-result").locator("li").allInnerTexts();
  console.log(`Ausgabe (${Math.round((Date.now() - t0) / 1000)} s): ${files.map((f) => f.split("\n")[0]).join(" | ")}`);
  if (
    !files.some((f) => f.includes(".mp4")) ||
    !files.some((f) => f.includes(".docx")) ||
    !files.some((f) => f.includes(".fcpxml"))
  )
    throw new Error("Ausgabe unvollständig");
  await shot("-ausgegeben");
  if (process.env.FELDSPUR_EXPORT_KEEP) cpSync(out, process.env.FELDSPUR_EXPORT_KEEP, { recursive: true });

  await page.getByRole("tab", { name: /Durchsehen/ }).click();
  if (process.env.FELDSPUR_SCREENSHOT) {
    await page.emulateMedia({ colorScheme: "dark" });
    await page
      .getByTestId("tl-diary")
      .first()
      .evaluate((b) => (b as HTMLElement).click());
    await shot("-dunkel");
  }
  console.log("Rauchtest ok");
} catch (e) {
  failed = true;
  console.error(e);
  if (logs.length) console.error(`Konsole:\n${logs.join("\n")}`);
  if (process.env.FELDSPUR_SCREENSHOT) {
    await page.screenshot({ path: process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, "-fehler.png") }).catch(() => {});
  }
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
