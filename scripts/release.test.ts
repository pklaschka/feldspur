import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  bumpFiles,
  changelogSection,
  checkNewVersion,
  compareVersions,
  previousTag,
  releaseBody,
  tidyGeneratedNotes,
  updateChangelog,
} from "./release.ts";

describe("Versionen", () => {
  it("ordnet Vorabversionen vor das Release", () => {
    const sorted = ["0.2.0", "0.2.0-rc.2", "0.1.0", "0.2.0-alpha.1", "0.2.0-rc.10", "0.2.0-beta.1"].sort(
      compareVersions,
    );
    expect(sorted).toEqual(["0.1.0", "0.2.0-alpha.1", "0.2.0-beta.1", "0.2.0-rc.2", "0.2.0-rc.10", "0.2.0"]);
  });

  it("lehnt ungültige, doppelte und ältere Versionen ab", () => {
    const tags = ["v0.1.0", "v0.2.0-rc.1", "irgendwas"];
    expect(() => checkNewVersion(tags, "0.2")).toThrow(/keine gültige Version/);
    expect(() => checkNewVersion(tags, "0.2.0-rc.1")).toThrow(/gibt es schon/);
    expect(() => checkNewVersion(tags, "0.1.5")).toThrow(/kleiner/);
    expect(() => checkNewVersion(tags, "0.2.0-rc.2")).not.toThrow();
    expect(() => checkNewVersion(tags, "0.2.0")).not.toThrow();
  });

  it("sammelt für ein Release seit dem letzten Release, für eine Vorabversion seit dem letzten Tag", () => {
    const tags = ["v0.1.0", "v0.2.0-rc.1", "v0.2.0-rc.2"];
    expect(previousTag(tags, "0.2.0")).toBe("v0.1.0");
    expect(previousTag(tags, "0.2.0-rc.3")).toBe("v0.2.0-rc.2");
    expect(previousTag([], "0.1.0")).toBeNull();
  });
});

const GENERATED = `## What's Changed
### Neu
* Zeitachse: Lagen prüfen by @pklaschka in https://github.com/pklaschka/feldspur/pull/24
### Behoben
* Echtzeit-Schleife by @pklaschka in https://github.com/pklaschka/feldspur/pull/22

## New Contributors
* @jemand made their first contribution in https://github.com/pklaschka/feldspur/pull/30

**Full Changelog**: https://github.com/pklaschka/feldspur/compare/v0.1.0...v0.2.0`;

describe("Changelog", () => {
  it("bringt GitHubs Notizen ins deutsche Format", () => {
    const notes = tidyGeneratedNotes(GENERATED);
    expect(notes).not.toContain("What's Changed");
    expect(notes).toContain(
      "- Zeitachse: Lagen prüfen ([#24](https://github.com/pklaschka/feldspur/pull/24), @pklaschka)",
    );
    expect(notes).toContain("### Neu dabei");
    expect(notes).toContain("**Alle Änderungen**: https://github.com/pklaschka/feldspur/compare/v0.1.0...v0.2.0");
  });

  it("sagt es, wenn keine Pull Requests dabei waren", () => {
    expect(tidyGeneratedNotes("**Full Changelog**: x")).toMatch(/^Keine über Pull Requests/);
  });

  it("legt das Changelog an und fasst Vorabversionen beim Release zusammen", () => {
    let md = updateChangelog(null, "0.2.0-rc.1", "2026-11-15", "- A");
    expect(md).toMatch(/^# Changelog/);
    expect(md).toContain("## 0.2.0-rc.1 – 2026-11-15 (Vorabversion)\n\n- A");
    md = updateChangelog(md, "0.2.0-rc.2", "2026-11-16", "- B");
    expect(md.indexOf("0.2.0-rc.2")).toBeLessThan(md.indexOf("0.2.0-rc.1"));
    md = updateChangelog(md + "\n## 0.1.0 – 2026-11-01\n\n- Alt\n", "0.2.0", "2026-11-20", "- A\n- B");
    expect(md).not.toContain("rc.1");
    expect(md).not.toContain("rc.2");
    expect(md).toContain("## 0.2.0 – 2026-11-20\n\n- A\n- B");
    expect(md).toContain("## 0.1.0 – 2026-11-01");
    expect(changelogSection(md, "0.2.0")).toBe("- A\n- B");
    expect(changelogSection(md, "0.1.0")).toBe("- Alt");
  });

  it("warnt im Release-Text vor Vorabversionen", () => {
    expect(releaseBody("0.2.0-rc.1", "- A", "o/r")).toContain("Vorabversion zum Testen");
    expect(releaseBody("0.2.0", "- A", "o/r")).toContain("Feldspur-0.2.0-win-x64.exe");
  });
});

describe("Versionsdateien", () => {
  it("setzt die Version nur in App, CITATION.cff und .zenodo.json", () => {
    const root = mkdtempSync(join(tmpdir(), "feldspur-release-"));
    mkdirSync(join(root, "apps", "desktop"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{\n  "name": "feldspur",\n  "version": "0.1.0"\n}\n');
    writeFileSync(join(root, "apps", "desktop", "package.json"), '{ "version": "0.1.0" }\n');
    writeFileSync(join(root, ".zenodo.json"), '{ "title": "x", "version": "0.1.0" }\n');
    writeFileSync(join(root, "CITATION.cff"), "cff-version: 1.2.0\nversion: 0.1.0\nlicense: EUPL-1.2\n");
    const touched = bumpFiles(root, "0.2.0-rc.1", "2026-11-15");
    expect(touched.sort()).toEqual([".zenodo.json", "CITATION.cff", "apps/desktop/package.json", "package.json"]);
    expect(readFileSync(join(root, "CITATION.cff"), "utf8")).toBe(
      'cff-version: 1.2.0\nversion: 0.2.0-rc.1\ndate-released: "2026-11-15"\nlicense: EUPL-1.2\n',
    );
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version).toBe("0.2.0-rc.1");
  });
});
