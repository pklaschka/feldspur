/**
 * Zuletzt geöffnete Projekte: eine kleine Liste im Benutzerordner der App, neueste zuerst.
 * Dazu meldet die App jede Datei dem Betriebssystem (Dock, Sprungliste, „Zuletzt verwendet“).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { RecentProject } from "../shared/api.ts";

const MAX = 12;
const file = () => join(app.getPath("userData"), "zuletzt-geoeffnet.json");

function read(): Omit<RecentProject, "missing">[] {
  try {
    const list = JSON.parse(readFileSync(file(), "utf8")) as unknown;
    return Array.isArray(list)
      ? list.filter((x): x is Omit<RecentProject, "missing"> => typeof x?.path === "string").slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

function write(list: Omit<RecentProject, "missing">[]): void {
  try {
    mkdirSync(dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify(list.slice(0, MAX), null, 2));
  } catch {
    // Die Liste ist eine Bequemlichkeit; ohne sie geht alles weiter.
  }
}

export function recentProjects(): RecentProject[] {
  return read().map((r) => ({ ...r, missing: !existsSync(r.path) }));
}

export function rememberProject(path: string, name: string): void {
  write([{ path, name, openedAt: new Date().toISOString() }, ...read().filter((r) => r.path !== path)]);
  app.addRecentDocument(path);
}

export function forgetProject(path: string): RecentProject[] {
  write(read().filter((r) => r.path !== path));
  return recentProjects();
}
