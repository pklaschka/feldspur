/**
 * „Alle Einsätze ausgeben…“ (`apps/desktop/src/main/project-export.ts`, Issue #209): ein Projektordner mit einem
 * Unterordner je Einsatz und einer gemeinsamen LIESMICH. Braucht ffmpeg für die Testaufnahmen, sonst übersprungen.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { applyImport, scanPaths, setProjectDataset } from "@feldspur/media";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { hasFfmpeg, makeSyncVideo } from "../../../packages/media/test/fixtures.ts";
import { fakeWebContents } from "./fake-webcontents.ts";
import { fakePowerSaveBlocker } from "./power-blocker.ts";
import { IPC, type ExportChoices, type ProjectExportProgress } from "../src/shared/api.ts";

const userData = mkdtempSync(join(tmpdir(), "feldspur-userdata-"));
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  ipcMain: { on: () => {}, handle: () => {} },
  powerSaveBlocker: fakePowerSaveBlocker(),
}));
const { exportRunning } = await import("../src/main/export.ts");
const { lastProjectParent, projectDirIn, runProjectExport } = await import("../src/main/project-export.ts");

describe.skipIf(!hasFfmpeg())("Alle Einsätze ausgeben", () => {
  let dir: string;
  let n = 0;
  const wc = fakeWebContents();
  const OPTS: ExportChoices = { video: false, readme: true, changeLog: true, manifest: true };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-projektordner-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  /** Ein erfundenes Projekt „Marktstudie“ mit zwei Einsätzen, jeder mit einem eigenen kurzen Video. */
  const projekt = async () => {
    const store = ProjectStore.open(":memory:");
    store.setMeta("name", "Marktstudie");
    const raw: string[] = [];
    const ids: string[] = [];
    for (const [i, title] of ["Wochenmarkt", "Flohmarkt"].entries()) {
      const folder = join(dir, `roh-${++n}`);
      mkdirSync(folder);
      raw.push(join(folder, "C0001.MP4"));
      makeSyncVideo(raw[i]!, { seconds: 2, creationTime: `2026-09-1${4 + i}T08:18:47.000000Z` });
      const id = store.addSession({ title, date: `2026-09-1${4 + i}`, place: "Südstadt", extra: {} }).id;
      applyImport(store, id, await scanPaths([folder]));
      ids.push(id);
    }
    return { store, ids, raw, out: join(dir, `aus-${n}`, "Marktstudie") };
  };
  const outcomes = (r: { sessions: { outcome: string }[] }) => r.sessions.map((x) => x.outcome);

  it("schreibt je Einsatz einen Ordner und darüber eine LIESMICH mit allen Montage-IDs", async () => {
    // Angenommen: zwei Einsätze und ein Titel für den Datensatz
    const { store, ids, out } = await projekt();
    setProjectDataset(store, { title: "Marktgespräche in der Südstadt" });
    const seen: ProjectExportProgress[] = [];
    const watch = fakeWebContents((channel: string, p: ProjectExportProgress) => {
      if (channel === IPC.projectExportProgress) seen.push(p);
    });
    // Wenn: beide in den Projektordner ausgegeben werden, mit Metadaten
    const r = await runProjectExport(store, watch, ids, out, { ...OPTS, roCrate: true, software: "Feldspur 0.5.0" });
    // Dann: ist der Ordner vollständig, mit einem Unterordner je Einsatz
    expect(outcomes(r)).toEqual(["written", "written"]);
    expect(r.complete).toBe(true);
    expect(readdirSync(out).sort()).toEqual([
      "Feldtag_2026-09-14_Wochenmarkt",
      "Feldtag_2026-09-15_Flohmarkt",
      "LIESMICH.html",
      "ro-crate-metadata.json",
    ]);
    // Und: Jeder Unterordner ist eine vollständige Ausgabe mit eigener LIESMICH
    expect(readdirSync(join(out, "Feldtag_2026-09-14_Wochenmarkt"))).toContain("LIESMICH.html");
    // Und: Die gemeinsame LIESMICH nennt Titel, beide Ordner und ihre Montage-IDs
    const html = readFileSync(join(out, "LIESMICH.html"), "utf8");
    expect(html).toContain("<h1>Marktgespräche in der Südstadt</h1>");
    expect(html).toContain("Eingang: Aufzeichnungen aus 2 Einsätzen (14.09.2026 bis 15.09.2026)");
    expect(html).toContain("Feldspur 0.5.0");
    for (const id of ids) {
      const record = store.getExportRecord(id)!;
      expect(html).toContain(`${basename(record.dir)}/LIESMICH.html`);
      expect(html).toContain(readFileSync(join(record.dir, "LIESMICH.html"), "utf8").match(/FS-\w+-\w+-\w+/)![0]);
    }
    // Und: Die Metadaten führen beide Ordner als Teile des Datensatzes
    const crate = JSON.parse(readFileSync(join(out, "ro-crate-metadata.json"), "utf8")) as {
      "@graph": { "@id": string; hasPart?: { "@id": string }[] }[];
    };
    expect(crate["@graph"].find((x) => x["@id"] === "./")!.hasPart!.map((x) => x["@id"])).toEqual([
      "LIESMICH.html",
      "Feldtag_2026-09-14_Wochenmarkt/",
      "Feldtag_2026-09-15_Flohmarkt/",
    ]);
    // Und: Die Oberfläche erfuhr, welcher Einsatz an der Reihe war, und die App ist danach wieder frei
    expect(seen.map((p) => p.sessionId)).toEqual([...ids, null]);
    expect(exportRunning()).toBe(false);
    store.close();
  });

  it("gibt unveränderte Einsätze nicht neu aus", async () => {
    // Angenommen: ein Projektordner mit zwei Einsätzen
    const { store, ids, out } = await projekt();
    await runProjectExport(store, wc, ids, out, OPTS);
    const docx = (id: string) => {
      const record = store.getExportRecord(id)!;
      return statSync(
        join(
          record.dir,
          record.files.find((f) => f.endsWith(".docx"))!,
        ),
      ).mtimeMs;
    };
    const before = ids.map(docx);
    // Wenn: nach einer Änderung am zweiten Einsatz erneut ausgegeben wird
    store.updateSession(ids[1]!, { place: "Nordstadt" });
    await new Promise((done) => setTimeout(done, 20));
    const r = await runProjectExport(store, wc, ids, out, OPTS);
    // Dann: wird nur der geänderte Einsatz neu geschrieben, und die LIESMICH ist wieder da
    expect(outcomes(r)).toEqual(["unchanged", "written"]);
    expect(docx(ids[0]!)).toBe(before[0]);
    expect(docx(ids[1]!)).toBeGreaterThan(before[1]!);
    expect(r.complete).toBe(true);
    expect(readFileSync(join(out, "LIESMICH.html"), "utf8")).toContain("Nordstadt");
    store.close();
  });

  it("schreibt die gemeinsame LIESMICH erst, wenn jeder gewählte Einsatz im Ordner liegt", async () => {
    // Angenommen: ein vollständiger Projektordner; danach ändert sich ein Einsatz und sein Original
    const { store, ids, raw, out } = await projekt();
    await runProjectExport(store, wc, ids, out, OPTS);
    store.updateSession(ids[1]!, { place: "Nordstadt" });
    appendFileSync(raw[1]!, "verändert");
    // Wenn: erneut ausgegeben wird
    const held = await runProjectExport(store, wc, ids, out, OPTS);
    // Dann: hält die Prüfung der Originale diesen Einsatz an, und die alte LIESMICH ist weg
    expect(outcomes(held)).toEqual(["unchanged", "held"]);
    expect(held.sessions[1]).toMatchObject({ blocking: false, detail: "1 Original ist verändert oder fehlt." });
    expect(held.complete).toBe(false);
    expect(existsSync(join(out, "LIESMICH.html"))).toBe(false);
    // Wenn: die Auffälligkeit für diesen Einsatz bewusst übergangen wird
    const done = await runProjectExport(store, wc, ids, out, { ...OPTS, accept: [ids[1]!] });
    // Dann: ist der Ordner vollständig
    expect(outcomes(done)).toEqual(["unchanged", "written"]);
    expect(done.complete).toBe(true);
    expect(existsSync(join(out, "LIESMICH.html"))).toBe(true);
    store.close();
  });

  it("lässt Einsätze ohne Quelle mit Uhrzeit aus und nennt Ordner früherer Läufe", async () => {
    // Angenommen: ein Projektordner mit zwei Einsätzen, dazu ein leerer dritter Einsatz
    const { store, ids, out } = await projekt();
    await runProjectExport(store, wc, ids, out, OPTS);
    const empty = store.addSession({ title: "Leer", date: "2026-09-16", extra: {} }).id;
    // Wenn: nur der erste und der leere Einsatz gewählt sind
    const r = await runProjectExport(store, wc, [ids[0]!, empty], out, OPTS);
    // Dann: zählt der leere nicht, und die LIESMICH nennt den Ordner des abgewählten, ohne ihn zu beschreiben
    expect(outcomes(r)).toEqual(["unchanged", "empty"]);
    expect(r.complete).toBe(true);
    const html = readFileSync(join(out, "LIESMICH.html"), "utf8");
    expect(html).toContain("Ausgabe eines Projekts mit einem Einsatz, 14.09.2026");
    expect(html).toContain("aus einer früheren Ausgabe");
    expect(html).toContain("<code>Feldtag_2026-09-15_Flohmarkt/</code>");
    store.close();
  });

  it("findet den Projektordner wieder, auch wenn er selbst gewählt wird", async () => {
    // Angenommen: ein geschriebener Projektordner
    const { store, ids, out } = await projekt();
    const parent = join(out, "..");
    expect(projectDirIn(store, parent)).toBe(out);
    await runProjectExport(store, wc, ids, out, OPTS);
    // Dann: Wer den Projektordner selbst wählt, bekommt keinen zweiten darin, und der Dialog beginnt eine Ebene höher
    expect(projectDirIn(store, out)).toBe(out);
    expect(lastProjectParent(store)).toBe(join(parent));
    store.close();
  });

  it("überschreibt keine fremde LIESMICH", async () => {
    // Angenommen: Im Zielordner liegt schon die LIESMICH eines einzelnen Einsatzes
    const { store, ids, out } = await projekt();
    await runProjectExport(store, wc, [ids[0]!], out, OPTS);
    const single = store.getExportRecord(ids[0]!)!.dir;
    // Wenn: dieser Ordner als Projektordner dienen soll, dann lehnt Feldspur ab und lässt die Datei, wie sie ist
    const before = readFileSync(join(single, "LIESMICH.html"), "utf8");
    await expect(runProjectExport(store, wc, ids, single, OPTS)).rejects.toThrow(/nicht von einem Projektordner/);
    expect(readFileSync(join(single, "LIESMICH.html"), "utf8")).toBe(before);
    expect(exportRunning()).toBe(false);
    store.close();
  });
});
