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
import { makeFieldDay } from "../../../packages/media/test/fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "feldspur-e2e-"));
const fixtures = join(dir, "Rohquellen");
makeFieldDay(fixtures);
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
  await page.getByText("ZOOM0004.m4a").waitFor();

  // Diktiergerät zur Referenzuhr machen.
  const zoomRow = page.locator(".dev", { hasText: "ZOOM" });
  await zoomRow.getByRole("radio").click();
  await zoomRow.getByText("Referenz").waitFor();
  // Kamera geht 2:47 vor.
  await page.getByLabel(/Abweichung .*Handy/).fill("+0:04");
  await page.getByLabel(/Abweichung .*Handy/).press("Enter");
  await page.getByLabel(/Abweichung .*C####/).fill("+2:47");
  await page.getByLabel(/Abweichung .*C####/).press("Enter");
  await page.locator("tr", { hasText: "C0012.MP4" }).getByText("10:16:00").waitFor();

  // Randnotiz auf der ersten Tagebuchseite: 10:12, Bezug reicht 15 Min. zurück.
  await page.getByLabel("Randnotiz T-01").fill("10:12");
  await page.getByLabel("Randnotiz T-01").press("Enter");
  await page.locator("tr", { hasText: "Tagebuch_S01.jpg" }).getByText("09:57:00 – 10:12:00").waitFor();

  await page.locator(".content").evaluate((el) => el.scrollTo(0, 0));
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
