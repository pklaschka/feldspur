/**
 * Rauchtest für Zeitbelege aus dem Kamera-Timecode (Issue #145): drei erfundene MOV-Clips einer Kamera mit frei
 * laufendem Timecode und Aufnahme-XML. Prüft die bildgenauen Belege, „Bestätigungen entfernen“ und „Zeitbelege neu
 * lesen“ im Gerätemenü.
 *
 *   vp run build && xvfb-run -a vpx test/timecode.e2e.ts
 *   FELDSPUR_SCREENSHOT=bild.png …     speichert Bildschirmfotos (bild-<schritt>.png)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";
import { ablauf } from "./ablauf.ts";
import { h264 } from "../../../packages/media/test/fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "feldspur-timecode-"));
const src = join(dir, "Kamera");
mkdirSync(src, { recursive: true });
// Uhr 10:18:27,4 / 10:25:03,9 / 10:40:12,62 (Ortszeit, Zone der Kamera +02:00); Timecode läuft 0:16:12,16 vor.
for (const [name, start, tc] of [
  ["P001C001.MOV", "2026-09-14T10:18:27+02:00", "10:34:39:28"],
  ["P001C002.MOV", "2026-09-14T10:25:03+02:00", "10:41:16:03"],
  ["P001C003.MOV", "2026-09-14T10:40:12+02:00", "10:56:24:39"],
] as const) {
  const xml = `<ClipMain><Shoot><StartDate>${start}</StartDate></Shoot></ClipMain>`;
  const utc = new Date(start).toISOString().replace(/\.\d+Z$/, "Z");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=50:duration=20",
    ...h264(),
    "-timecode",
    tc,
    "-metadata",
    `creation_time=${utc}`,
    "-movflags",
    "use_metadata_tags",
    "-metadata",
    `com.panasonic.Semi-Pro.metadata.xml=${xml}`,
    join(src, name),
  ]);
}

const sandbox = process.env.CI || process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const env = { ...process.env, FELDSPUR_USER_DATA: join(dir, "Benutzerordner") };
const project = join(dir, "Timecode.feldspur");
const app = await electron.launch({ args: [".", project, ...sandbox], cwd: join(import.meta.dirname, ".."), env });
const page = await app.firstWindow();
let failed = false;
const shot = async (suffix: string) => {
  if (!process.env.FELDSPUR_SCREENSHOT) return;
  await page.waitForTimeout(200);
  await page.screenshot({ path: process.env.FELDSPUR_SCREENSHOT.replace(/\.png$/, `-${suffix}.png`) });
};
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sessionId = await ablauf("Drei Clips einer Kamera einsammeln", async () => {
    await page.getByText("+ neuer Einsatz").click();
    await page.getByLabel("Titel").fill("Testmarkt");
    await page.getByLabel("Datum").fill("2026-09-14");
    await page.getByRole("button", { name: "Anlegen" }).click();
    await page.getByRole("heading", { name: "Testmarkt" }).waitFor();
    const id = await page.evaluate(async () => (await window.feldspur.currentProject())!.sessions[0]!.id);
    await page.evaluate(async ([i, p]) => window.feldspur.importPaths(i!, [p!]), [id, src]);
    return id;
  });

  await ablauf("Lage bildgenau aus dem Timecode", async () => {
    // Dann: folgen alle Lagen dem Timecode, untereinander auf 20 ms (ein Bild bei 50 fps)
    const starts = await page.evaluate(async (id) => {
      const v = await window.feldspur.getSession(id);
      return v.rows.toSorted((a, b) => a.fileName.localeCompare(b.fileName)).map((r) => [r.startMs!, r.basis] as const);
    }, sessionId);
    console.log(`Lagen: ${starts.map(([t, b]) => `${new Date(t).toISOString().slice(11, 23)} (${b})`).join(" | ")}`);
    if (!starts.every(([, b]) => /Kamera-Timecode/.test(b))) throw new Error("Lage folgt nicht dem Timecode");
    if (starts[1]![0] - starts[0]![0] !== 396_500) throw new Error("Abstand der Clips nicht bildgenau");
  });

  await ablauf("Bestätigungen gesammelt entfernen", async () => {
    // Angenommen: alle drei Lagen sind bestätigt
    await page.evaluate(async (id) => {
      const v = await window.feldspur.getSession(id);
      for (const r of v.rows) await window.feldspur.confirmPlacement(r.id, r.startMs!);
    }, sessionId);
    await page.reload();
    // Wenn: im Gerätemenü „Bestätigungen entfernen“ gewählt wird
    await page.getByRole("tab", { name: /Einsammeln/ }).click();
    await page
      .getByRole("button", { name: /^Aktionen für Gerät/ })
      .first()
      .click();
    const clear = page.getByRole("menuitem", { name: "Bestätigungen entfernen (3 Quellen)" });
    await clear.waitFor();
    await page.getByRole("menuitem", { name: "Zeitbelege neu lesen" }).waitFor();
    await shot("geraetemenue");
    await clear.click();
    // Dann: sind alle drei zurückgenommen, rückgängig zu machen
    await page.getByTestId("undo-toast").filter({ hasText: "Bestätigungen entfernt" }).waitFor();
    const checked = await page.evaluate(
      async (id) => (await window.feldspur.getSession(id)).allDevices.reduce((n, d) => n + d.checkedCount, 0),
      sessionId,
    );
    if (checked !== 0) throw new Error(`Noch ${checked} Bestätigungen`);
  });

  await ablauf("Zeitbelege neu lesen", async () => {
    // Wenn: im Gerätemenü „Zeitbelege neu lesen“ gewählt wird
    await page
      .getByRole("button", { name: /^Aktionen für Gerät/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Zeitbelege neu lesen" }).click();
    // Dann: sagt der Hinweis, dass sich nichts geändert hat
    const toast = page.getByTestId("undo-toast").filter({ hasText: "Zeitbelege neu gelesen: nichts geändert" });
    await toast.waitFor();
    console.log(`Hinweis: ${(await toast.innerText()).replace(/\s+/g, " ")}`);
    await shot("neu-gelesen");
  });
  console.log("Timecode-Rauchtest bestanden");
} catch (e) {
  failed = true;
  console.error(e);
  await page.screenshot({ path: join(tmpdir(), "feldspur-timecode-fehler.png") }).catch(() => {});
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
