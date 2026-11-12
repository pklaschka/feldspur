/**
 * Rauchtest der Desktop-App: startet Electron mit einem frischen Projekt,
 * legt einen Einsatz an, importiert erfundene Fixtures und prüft die Tabelle.
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
  await page.getByText("14.09. Testmarkt").first().waitFor();

  // Drag & Drop lässt sich nicht mit echten Dateipfaden simulieren; derselbe Weg über die API:
  const sessionId = await page.evaluate(async () => (await window.feldspur.currentProject())!.sessions[0]!.id);
  await page.evaluate(async ([id, p]) => window.feldspur.importPaths(id!, [p!]), [sessionId, sources]);
  await page.reload();
  await page
    .getByText(/ZOOM000\d\.m4a/)
    .first()
    .waitFor();

  // Diktiergerät zur Referenzuhr machen.
  const zoomRow = page.locator(".dev", { hasText: "ZOOM" });
  await zoomRow.getByRole("radio").click();
  await zoomRow.getByText("Referenz").waitFor();
  await page.getByLabel(/Abweichung .*Handy/).fill("+0:04");
  await page.getByLabel(/Abweichung .*Handy/).press("Enter");
  await page.locator(".dev", { hasText: "Handy Testperson A" }).getByText("von Hand").waitFor();

  // Kamera-Uhr über das Klatschen abgleichen lassen.
  await page.getByRole("button", { name: "Tonspuren abgleichen" }).click();
  const proposal = page.locator(".proposal").first();
  await proposal.waitFor({ timeout: 60_000 });
  const proposalText = await proposal.innerText();
  console.log(`Vorschlag: ${proposalText.replace(/\s+/g, " ")}`);
  if (!proposalText.includes("+2:47")) throw new Error("Vorschlag nennt nicht +2:47");
  if (process.env.FELDSPUR_SCREENSHOT) {
    await page.locator(".sync").scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, "-abgleich.png") });
  }
  await proposal.getByRole("button", { name: "Übernehmen" }).click();
  await page
    .locator("tr", { hasText: /C00(01|12)\.MP4/ })
    .getByText(/^10:16:00/)
    .waitFor();
  await page.locator(".dense .ep").first().waitFor();
  console.log(`Episoden: ${(await page.locator(".dense").innerText()).replace(/\s+/g, " ")}`);
  if (process.env.FELDSPUR_SCREENSHOT) {
    await page.locator(".dense").scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, "-episoden.png") });
  }

  // Randnotiz auf der ersten Tagebuchseite: 10:12, Bezug reicht 15 Min. zurück.
  await page.getByLabel("Randnotiz T-01").fill("10:12");
  await page.getByLabel("Randnotiz T-01").press("Enter");
  await page.locator("tr", { hasText: "Tagebuch_S01.jpg" }).getByText("09:57:00 – 10:12:00").waitFor();

  await page.locator(".content").evaluate((el) => el.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const rows = await page.locator("table.src tbody tr").allInnerTexts();
  console.log(rows.join("\n"));
  if (rows.length < 6) throw new Error(`Erwartet mindestens 6 Zeilen, gefunden ${rows.length}`);
  if (process.env.FELDSPUR_SCREENSHOT) await page.screenshot({ path: process.env.FELDSPUR_SCREENSHOT });
  console.log("Rauchtest ok");
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
