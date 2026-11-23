import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { pruneMontageCache } from "../src/montage-video.ts";

const DAY = 24 * 60 * 60 * 1000;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "feldspur-zwischenspeicher-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Zwischenspeicher eines Einsatzes, zuletzt vor `days` Tagen ausgegeben. */
function cache(name: string, days: number) {
  const dir = join(root, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "abschnitt.mp4"), "x");
  const at = new Date(Date.now() - days * DAY);
  utimesSync(dir, at, at);
}

describe("Montage-Zwischenspeicher", () => {
  it("räumt nur Einsätze weg, die 30 Tage nicht ausgegeben wurden", async () => {
    // Angenommen: drei Einsätze, vor 2, 29 und 45 Tagen ausgegeben
    cache("frisch", 2);
    cache("knapp", 29);
    cache("alt", 45);
    // Wenn: Feldspur startet
    const removed = await pruneMontageCache(root);
    // Dann: ist nur der alte weg
    expect(removed).toEqual([join(root, "alt")]);
    expect(readdirSync(root).sort()).toEqual(["frisch", "knapp"]);
  });

  it("tut nichts, wenn es noch keinen Zwischenspeicher gibt", async () => {
    expect(await pruneMontageCache(join(root, "gibt-es-nicht"))).toEqual([]);
  });
});
