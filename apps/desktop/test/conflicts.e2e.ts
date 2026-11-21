/**
 * Rauchtest für Widersprüche zwischen Zeitbelegen (Issue #75): erfundene Fotos, deren EXIF-Zeit und Dateiname
 * nicht zusammenpassen. Prüft Zeichen und Prüfliste, Entscheiden, Wiederöffnen und das Änderungsprotokoll.
 *
 *   vp run build && xvfb-run -a vpx test/conflicts.e2e.ts
 *   FELDSPUR_SCREENSHOT=bild.png …     speichert Bildschirmfotos (bild-<schritt>.png)
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";
import { ablauf } from "./ablauf.ts";
import { makePhoto, makeSyncAudio } from "../../../packages/media/test/fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "feldspur-widerspruch-"));
const src = join(dir, "Rohquellen");
mkdirSync(src, { recursive: true });
makeSyncAudio(join(src, "ZOOM0001.m4a"), {
  seconds: 1800,
  creationTime: "2026-09-14T08:15:00.000000Z",
  talk: [[0, 1800]],
});
const handy = { make: "Beispiel", model: "Handy Testperson A" };
// Stark: Dateiname 10:45:00, EXIF 10:32:07 (+12:53). Deutlich: 10:29:00 gegen 10:27:40. Rundung: 10:18 gegen 10:19:05.
makePhoto(join(src, "IMG_20260914_104500.jpg"), "0x8a4fbf", { ...handy, dateTimeOriginal: "2026:09:14 10:32:07" });
makePhoto(join(src, "IMG_20260914_102900.jpg"), "0x2a52be", { ...handy, dateTimeOriginal: "2026:09:14 10:27:40" });
makePhoto(join(src, "IMG_20260914_1018.jpg"), "0x1f8a70", { ...handy, dateTimeOriginal: "2026:09:14 10:19:05" });
// Ganze Kamera: Dateiname in Ortszeit, EXIF zwei Stunden später.
const stativ = { make: "Beispiel", model: "Kamera Stativ" };
for (const [i, t] of [
  [1, "10:20:10"],
  [2, "10:24:30"],
  [3, "10:38:05"],
] as const) {
  const [h, m, s] = t.split(":").map(Number) as [number, number, number];
  const name = `DSC_20260914_${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}${String(s).padStart(2, "0")}.jpg`;
  makePhoto(join(src, name), ["0x995533", "0x339955", "0x335599"][i - 1]!, {
    ...stativ,
    dateTimeOriginal: `2026:09:14 ${h + 2}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
  });
}

const sandbox = process.env.CI || process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const env = { ...process.env, FELDSPUR_USER_DATA: join(dir, "Benutzerordner") };
const project = join(dir, "Widerspruch.feldspur");
const launch = () => electron.launch({ args: [".", project, ...sandbox], cwd: join(import.meta.dirname, ".."), env });
let app = await launch();
let page = await app.firstWindow();
let failed = false;
const [vw, vh] = (process.env.FELDSPUR_VIEWPORT ?? "1440x900").split("x").map(Number);
const shot = async (suffix: string) => {
  if (!process.env.FELDSPUR_SCREENSHOT) return;
  await page.waitForTimeout(200);
  await page.screenshot({ path: process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, `-${suffix}.png`) });
};
try {
  await page.setViewportSize({ width: vw!, height: vh! });
  const list = await ablauf("Einen Einsatz mit widersprüchlichen Fotos einsammeln", async () => {
    // Angenommen: ein Rekorder als Referenzuhr und zwei Fotogeräte mit richtig gestellter Uhr
    await page.getByText("+ neuer Einsatz").click();
    await page.getByLabel("Titel").fill("Testmarkt");
    await page.getByLabel("Datum").fill("2026-09-14");
    await page.getByRole("button", { name: "Anlegen" }).click();
    await page.getByRole("heading", { name: "Testmarkt" }).waitFor();
    const sessionId = await page.evaluate(async () => (await window.feldspur.currentProject())!.sessions[0]!.id);
    await page.evaluate(async ([id, p]) => window.feldspur.importPaths(id!, [p!]), [sessionId, src]);
    await page.evaluate(async (id) => {
      const v = await window.feldspur.getSession(id);
      for (const d of v.devices) {
        if (d.kind === "audio") await window.feldspur.setReference(d.id);
        else await window.feldspur.setDeviceOffset(d.id, 0);
      }
    }, sessionId);
    await page.reload();
    await page.getByRole("tab", { name: /Durchsehen/ }).click();
    const list = page.getByTestId("check-list");
    await list.waitFor();
    return list;
  });

  await ablauf("Überblick über die Widersprüche", async () => {
    // Dann: nennt der Stand des Einsatzes die Widersprüche, die Prüfliste sortiert die starken nach oben
    await page.getByText(/Zeitbelege widersprechen sich an \d Stellen/).waitFor();
    const strong = await page.getByTestId("filter-strong").innerText();
    const clear = await page.getByTestId("filter-clear").innerText();
    console.log(`Filter: ${strong.replace(/\s+/g, " ")} | ${clear.replace(/\s+/g, " ")}`);
    if (!(await list.getByTestId("check-group").count())) throw new Error("Kamera Stativ fehlt als Gruppe");
    if (await list.getByTestId("check-row").filter({ hasText: "IMG_20260914_1018" }).count())
      throw new Error("Rundung darf nicht in der Prüfliste stehen");
    await shot("ueberblick");
  });

  const panel = await ablauf("Einen starken Widerspruch ansehen", async () => {
    // Wenn: ein starker Widerspruch gewählt wird, dann zeigt der Kasten den Vergleich und die Zeitachse die Vergleichslage
    await list.getByTestId("check-row").filter({ hasText: "F-003" }).first().click();
    const panel = page.getByTestId("conflict-panel");
    await panel.waitFor();
    await panel.getByTestId("evidence-strip").waitFor();
    console.log(`Kasten: ${(await panel.innerText()).split("\n").slice(0, 3).join(" | ")}`);
    await shot("offen");
    return panel;
  });

  await ablauf("Den Widerspruch entscheiden", async () => {
    // Wenn: ein anderer Beleg gewählt wird, dann steht die Folge da, bevor gespeichert wird
    await panel.getByRole("radio").nth(1).check();
    await panel.getByTestId("decision-consequence").waitFor();
    await shot("anderer-beleg");
    // Wenn: doch der verwendete Beleg mit Begründung bestätigt wird, dann gilt er als entschieden
    await panel.getByRole("radio").nth(0).check();
    await panel.getByLabel("Begründung").fill("Datei beim Export umbenannt");
    await panel.getByTestId("decide").click();
    const done = page.getByTestId("conflict-decided");
    await done.waitFor();
    console.log(`Entschieden: ${(await done.innerText()).replace(/\s+/g, " ")}`);
    await shot("entschieden");
  });

  await ablauf("Eine ganze Kamera auf einmal entscheiden", async () => {
    // Wenn: die Gruppe der Kamera gewählt wird, dann nennt der Kasten die weiteren Dateien und eine Ursache
    await list
      .getByTestId("check-group")
      .getByRole("button", { name: /Ursache klären|Entscheiden/ })
      .click();
    await panel.waitFor();
    await panel.getByText(/Dasselbe bei 2 weiteren Dateien/).waitFor();
    await panel.getByTestId("conflict-cause").waitFor();
    await shot("gruppe");
    // Wenn: für alle drei gleich entschieden wird
    await panel.getByRole("button", { name: /Für alle 3 gleich entscheiden/ }).click();
    await shot("gruppe-alle");
    await panel.getByTestId("group-decide").getByRole("button").first().click();
    await page.getByTestId("conflict-decided").waitFor();
    // Dann: sind alle entschieden, und Rückgängig wird angeboten
    await page
      .getByText(/^Widersprüche entschieden/)
      .first()
      .waitFor();
    const decidedCount = await page.getByTestId("filter-decided").innerText();
    if (!/4/.test(decidedCount)) throw new Error(`Entschieden: ${decidedCount}`);
  });

  await ablauf("Die Entscheidung nach dem Wiederöffnen", async () => {
    // Wenn: das Projekt neu geöffnet wird, dann ist die Entscheidung mit Begründung da
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: vw!, height: vh! });
    await page.getByRole("tab", { name: /Durchsehen/ }).click();
    await page.getByTestId("filter-decided").click();
    await page.getByTestId("check-list").getByText("Datei beim Export umbenannt").waitFor();
    await shot("wiedergeoeffnet");
  });

  await ablauf("Das Änderungsprotokoll lesen", async () => {
    // Dann: hat das Änderungsprotokoll sprechende Einträge
    await page.getByTestId("project-menu").click();
    await page.getByRole("menuitem", { name: "Änderungsprotokoll…" }).click();
    const log = page.getByTestId("change-log");
    const step = log
      .getByTestId("change-step")
      .filter({ hasText: /Widerspruch entschieden: / })
      .first();
    await step.waitFor();
    await step.getByRole("button").click();
    await step
      .getByText(/Stand beim Entscheiden/)
      .first()
      .waitFor();
    await shot("protokoll");
    await page.keyboard.press("Escape");
    await log.waitFor({ state: "detached" });
  });

  await ablauf("Im dunklen Modus ansehen", async () => {
    // Wenn: das System auf dunkel steht, dann ist die Prüfliste auch dunkel lesbar (Bildschirmfoto)
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByTestId("filter-all").click();
    await page.getByTestId("check-list").getByTestId("check-row").first().click();
    await shot("dunkel");
  });
  console.log("Widersprüche ok");
} catch (e) {
  failed = true;
  console.error(e);
  await page
    .screenshot({
      path: join(
        process.env.FELDSPUR_SCREENSHOT
          ? process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, "-fehler.png")
          : join(tmpdir(), "widerspruch-fehler.png"),
      ),
    })
    .catch(() => {});
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
