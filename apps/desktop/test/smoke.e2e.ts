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
import { makePhoto, makeSyncDay } from "../../../packages/media/test/fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "feldspur-e2e-"));
const fixtures = join(dir, "Rohquellen");
makeSyncDay(fixtures);
makePhoto(join(fixtures, "IMG_0231.jpg"), "0x8a4fbf", {
  make: "Beispiel",
  model: "Handy Testperson A",
  dateTimeOriginal: "2026:09:14 10:12:34",
});
makePhoto(join(fixtures, "IMG_20260914_104050.jpg"), "0x1f8a70");
makePhoto(join(fixtures, "Tagebuch_S01.jpg"), "0xc2703d");
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
    .getByText("über Tonspur")
    .waitFor();

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
