/**
 * Rauchtest der Desktop-App: startet Electron mit einem frischen Projekt,
 * legt einen Einsatz an, importiert erfundene Fixtures und geht die vier Schritte durch.
 *
 *   pnpm --filter @feldspur/desktop e2e            (Linux ohne Bildschirm: xvfb-run -a …)
 *   FELDSPUR_SCREENSHOT=bild.png …                 speichert ein Bildschirmfoto
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";
import { makeDiaryPage, makePhoto, makeSyncDay } from "../../../packages/media/test/fixtures.ts";

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

const app = await electron.launch({
  args: [".", join(dir, "Test.feldspur"), ...(process.env.CI || process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
  cwd: join(import.meta.dirname, ".."),
});
let failed = false;
try {
  const page = await app.firstWindow();
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
  await page.mouse.click(xAt(10 * 60 + 5), box.y + 30 + 40 + (tracks.length - 1) * 46 + 23);
  await page.getByTestId("inspector").getByText("Tagebuch_S01.jpg").first().waitFor();
  await page.getByRole("button", { name: "Schließen" }).click();
  // Klick in die Tonspur spult den Player dorthin: 10:16:20 ist im Rekorder 1:20.
  await page.mouse.click(xAt(10 * 60 + 16 + 1 / 3), box.y + 30 + 40 + 23);
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
  await page.mouse.move(xAt(10 * 60 + 16), box.y + 30 + 40 + 23);
  await shot("-durchsehen");
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
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
