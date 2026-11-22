/**
 * Rauchtest für großen Ordnerimport (Issue #73) und den Stand der Ausgabe über Neustarts (Issue #72).
 *
 * Großer Ordner: viele große, leere (dünn belegte) Videodateien, damit das Lesen der Prüfsummen dauert. Prüft
 * Fortschritt, Abbrechen ohne Spuren und den zweiten Versuch. Ausgabe: ohne Video ausgeben, App neu starten,
 * „Aktuell“ erwarten; dann etwas ändern und „Veraltet“ mit Begründung erwarten.
 *
 *   vp run build && xvfb-run -a vpx test/export-import.e2e.ts
 *   FELDSPUR_SCREENSHOT=bild.png …     speichert Bildschirmfotos (bild-<schritt>.png)
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import { ablauf } from "./ablauf.ts";
import { makePhoto, makeSyncDay } from "../../../packages/media/test/fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "feldspur-ordner-"));
const big = join(dir, "Speicherkarte");
mkdirSync(join(big, "DCIM", "100MSDCF"), { recursive: true });
// Dünn belegte Dateien: groß für die Prüfsumme, aber kaum Platz auf der Platte.
const BIG_FILES = 40;
for (let i = 1; i <= BIG_FILES; i++) {
  const f = join(big, "DCIM", "100MSDCF", `C${String(i).padStart(4, "0")}.MP4`);
  writeFileSync(f, "");
  truncateSync(f, 2 * 1024 ** 3);
}
const raw = join(dir, "Rohquellen");
makeSyncDay(raw);
makePhoto(join(raw, "IMG_20260914_104050.jpg"), "0x1f8a70");
const out = join(dir, "Ausgabe");
mkdirSync(out);

const sandbox = process.env.CI || process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const env = { ...process.env, FELDSPUR_USER_DATA: join(dir, "Benutzerordner") };
const project = join(dir, "Ordner.feldspur");
const [vw, vh] = (process.env.FELDSPUR_VIEWPORT ?? "1440x900").split("x").map(Number);
let app!: ElectronApplication;
let page!: Page;
const launch = async () => {
  app = await electron.launch({ args: [".", project, ...sandbox], cwd: join(import.meta.dirname, ".."), env });
  page = await app.firstWindow();
  await page.setViewportSize({ width: vw!, height: vh! });
};
const pickFolder = (folder: string) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
  }, folder);
const shot = async (suffix: string) => {
  if (!process.env.FELDSPUR_SCREENSHOT) return;
  await page.waitForTimeout(200);
  await page.screenshot({ path: process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, `-${suffix}.png`) });
};
const sourceCount = (id: string) => page.evaluate(async (s) => (await window.feldspur.getSession(s)).rows.length, id);

let failed = false;
await launch();
try {
  const sessionId = await ablauf("Einen Einsatz anlegen", async () => {
    await page.getByText("+ neuer Einsatz").click();
    await page.getByLabel("Titel").fill("Testmarkt");
    await page.getByLabel("Datum").fill("2026-09-14");
    await page.getByRole("button", { name: "Anlegen" }).click();
    await page.getByRole("heading", { name: "Testmarkt" }).waitFor();
    const sessionId = await page.evaluate(async () => (await window.feldspur.currentProject())!.sessions[0]!.id);
    return sessionId;
  });

  const progress = await ablauf("Einen großen Ordner einsammeln und abbrechen", async () => {
    // Wenn: ein Ordner mit 40 Videos eingesammelt wird, dann zeigt die App Fortschritt und Restzeit
    await pickFolder(big);
    await page.getByRole("button", { name: "Dateien wählen…" }).click();
    const progress = page.getByTestId("import-progress");
    await progress.waitFor();
    await page.waitForFunction(() => {
      const t = document.querySelector("[data-testid=import-count]")?.textContent ?? "";
      return /^([4-9]|\d\d) von 40/.test(t);
    });
    await page.waitForTimeout(5500); // bis die Restzeit geschätzt ist
    const during = await progress.innerText();
    await shot("1-fortschritt");
    // Wenn: abgebrochen wird, dann bleibt keine Quelle zurück
    await page.getByTestId("import-cancel").click();
    await page.getByTestId("import-cancelled").waitFor();
    const cancelled = await page.getByTestId("import-cancelled").innerText();
    if ((await sourceCount(sessionId)) !== 0) throw new Error("Abbruch hat Quellen hinterlassen");
    await shot("2-abgebrochen");
    console.log(`Fortschritt: ${during.replace(/\n+/g, " | ")}`);
    console.log(`Abgebrochen: ${cancelled}`);
    return progress;
  });

  await ablauf("Den großen Ordner erneut einsammeln", async () => {
    // Wenn: noch einmal eingesammelt wird, dann übernimmt die App, was sie schon gelesen hat
    // (danach wieder abbrechen, denn die Dateien sind keine echten Videos)
    await page.getByRole("button", { name: "Dateien wählen…" }).click();
    await progress.getByText(/aus dem letzten Versuch übernommen/).waitFor();
    await shot("3-zweiter-versuch");
    await page.getByTestId("import-cancel").click();
    await page.getByTestId("import-cancelled").waitFor();
    if ((await sourceCount(sessionId)) !== 0) throw new Error("Zweiter Abbruch hat Quellen hinterlassen");
  });

  await ablauf("Echte Quellen einsammeln", async () => {
    // Angenommen: echte Quellen, der Rekorder ist die Referenzuhr
    await pickFolder(raw);
    await page.getByRole("button", { name: "Dateien wählen…" }).click();
    await page.getByTestId("import-notice").waitFor();
    await page.evaluate(async (id) => {
      const v = await window.feldspur.getSession(id);
      const rec = v.devices.find((d) => d.kind === "audio");
      if (rec) await window.feldspur.setReference(rec.id);
    }, sessionId);
  });

  await ablauf("Ohne Video ausgeben", async () => {
    // Wenn: ohne Montagevideo ausgegeben wird, dann ist die Ausgabe fertig
    await page.reload();
    await page.getByRole("tab", { name: /Ausgeben/ }).click();
    await page.getByRole("switch", { name: "Montagevideo mit ausgeben" }).click();
    await pickFolder(out);
    await page.getByRole("button", { name: /^(Trotzdem a|A)usgeben…$/ }).click();
    const anyway = page.getByTestId("export-anyway");
    const result = page.getByTestId("export-result");
    await Promise.race([anyway.waitFor().then(() => anyway.click()), result.waitFor({ timeout: 120_000 })]);
    await result.waitFor({ timeout: 120_000 });
    await result.getByText("Fertig.").waitFor();
    // Dann: Dateien außerhalb der Ausgabe lassen sich darüber nicht öffnen
    const fremd = await page.evaluate((id) => window.feldspur.openExportFile(id, "../../etc/passwd"), sessionId);
    if (fremd) throw new Error("openExportFile öffnet eine Datei außerhalb der Ausgabe");
  });

  await ablauf("Nach einem Neustart ist die Ausgabe aktuell", async () => {
    // Wenn: die App neu startet, dann gilt die Ausgabe weiter als aktuell
    await app.close();
    await launch();
    await page.getByRole("tab", { name: /Ausgeben/ }).click();
    await page.getByTestId("export-result").getByText("Aktuell.").waitFor();
    await shot("4-aktuell-nach-neustart");
  });

  await ablauf("Nach Änderungen ist die Ausgabe veraltet", async () => {
    // Wenn: Ort und ein Original geändert werden und die App neu startet
    // Dann: ist die Ausgabe veraltet, mit Begründung
    await page.evaluate(async (id) => window.feldspur.updateSession(id, { place: "Marktplatz Süd" }), sessionId);
    appendFileSync(join(raw, "IMG_20260914_104050.jpg"), "nachbearbeitet");
    await app.close();
    await launch();
    await page.getByRole("tab", { name: /Ausgeben/ }).click();
    const stale = page.getByTestId("export-stale");
    await stale.waitFor();
    const reasons = await page.getByTestId("export-differences").innerText();
    if (!/Im Einsatz hat sich seitdem etwas geändert/.test(reasons) || !/Originaldatei wurde/.test(reasons))
      throw new Error(`Begründung unvollständig: ${reasons}`);
    await shot("5-veraltet");
  });
  await ablauf("Eine andere Einstellung ist auch ein Unterschied", async () => {
    // Wenn: eine andere Einstellung gewählt wird, dann nennt die App auch sie
    await page.getByRole("switch", { name: "Ton aller Geräte mischen" }).click();
    await page
      .getByTestId("export-differences")
      .getByText(/nur Ton der Hauptquelle/)
      .waitFor();
    await page.emulateMedia({ colorScheme: "dark" });
    await shot("6-veraltet-dunkel");
    console.log(`Veraltet: ${(await page.getByTestId("export-differences").innerText()).replace(/\n+/g, " | ")}`);
  });
  console.log("Ordnerimport und Ausgabestand ok");
} catch (e) {
  failed = true;
  console.error(e);
  await page
    .screenshot({
      path: process.env.FELDSPUR_SCREENSHOT
        ? process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, "-fehler.png")
        : join(tmpdir(), "ordner-fehler.png"),
    })
    .catch(() => {});
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
