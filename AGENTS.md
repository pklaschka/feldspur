<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Feldspur

- Sprache: Oberfläche, Kommentare und Commit-Texte auf Deutsch; Bezeichner im Code auf Englisch.
- Lage auf der Zeitachse nie speichern, immer aus Belegen berechnen (`packages/core/src/resolve.ts`).
- Migrationen in `packages/core/src/db/migrations.ts` nur anhängen, nie ändern.
- IPC-Aufrufe, die Daten ändern, mit `undoable(…, "Beschriftung", …)` anmelden (Rückgängig, `packages/core/src/db/history.ts`);
  liefert die Änderung nur den Einsatz für die neue Ansicht, mit `undoableView`.
  Schreibt etwas außerhalb davon in die Projektdatei, leert das den Verlauf.
- ffmpeg/ffprobe nur über `runTool` (`packages/media/src/process.ts`) starten und das `signal` immer durchreichen; eine
  Lint-Regel sperrt `node:child_process` in `src`. Keine eigenen Promise-Hüllen um Prozesse und kein Effect
  (bewusst entschieden am 20.11.2026, Issue #134).
- Keine echten Forschungsdaten in Tests oder Fixtures.
- Arbeitsprotokoll (Issue #168): Schritte mit Dateien (Einsammeln, Prüfen, Originale suchen, Ausgeben, Montage,
  Sicherungen, jeder ffmpeg/ffprobe-Aufruf mit Befehlszeile) mit `log(bereich, text)` aus `packages/media/src/log.ts`
  vermerken. Erscheint auf stderr, in der nicht gepackten App von selbst; `FELDSPUR_LOG=1` schaltet es überall ein
  (auch in Tests und in der installierten App, aus dem Terminal gestartet), `FELDSPUR_LOG=0` ab.
- Vor dem Commit: `vp run check` und `vp run test` (`check` enthält zusätzlich die Typprüfung der App und knip).
- `export` nur für das, was ein anderes Modul oder ein Test braucht: knip (`knip.jsonc`) meldet ungenutzte Exporte,
  Dateien und Abhängigkeiten als Fehler.

## Checklisten

**Neue Tabelle in der Projektdatei:**

1. Neue Stufe am Ende von `packages/core/src/db/migrations.ts` und dieselbe Tabelle in `packages/core/src/db/schema.ts`
   (`schema.test.ts` vergleicht beide).
2. Nur Zwischenergebnis oder Ausgabestand? Dann in `CACHE_TABLES` (`packages/core/src/db/history.ts`): leert den
   Verlauf nicht und fehlt im Änderungsprotokoll.
3. Sonst einen deutschen Namen in `TABLE_LABEL` (`apps/desktop/src/shared/changelog.ts`, ein Test prüft das) und
   prüfen, ob `sessionSteps` (`apps/desktop/src/main/changelog.ts`) die Zeilen dem richtigen Einsatz zuordnet
   (`session_id` oder `source_id`).
4. Gehört die Tabelle zu einem Einsatz: in die Löschliste von `deleteSession` (`packages/core/src/db/store.ts`).
5. Bestimmt sie, was ausgegeben wird: in `contentHash` (`packages/media/src/export-state.ts`), sonst bleibt eine
   veraltete Ausgabe „aktuell“.
6. Nach dem Release, das die Stufe enthält: ihren Fingerabdruck in `FROZEN` (`packages/core/test/migrations.test.ts`)
   nachtragen.

**Neuer IPC-Aufruf:** Kanal in `IPC` und Methode in der Schnittstelle (`apps/desktop/src/shared/api.ts`), Brücke in
`apps/desktop/src/preload/preload.ts`, Handler in der passenden Datei unter `apps/desktop/src/main/ipc/` (ändert er
Daten: `undoable` oder `undoableView` aus `ipc/undoable.ts`). Offenes Projekt, Fenster und laufende Arbeiten nur über
`apps/desktop/src/main/state.ts`. Nach jedem `await` im Handler mit `stillOpen(s)` prüfen, ob noch dasselbe Projekt
offen ist.

**Neue Ausgabe-Option:** nur in `ExportRequestOptions` (`apps/desktop/src/shared/api.ts`) ergänzen; `ExportChoices` und
`ExportRequest` leiten sich davon ab. Danach `exportSettings` (`apps/desktop/src/main/export.ts`) und, falls sie das
Ergebnis ändert, den Fingerabdruck nachziehen.

## Tests lesbar schreiben

Tests werden im Review gelesen wie das Handbuch. Kein Gherkin, kein Cucumber und keine weitere Testbibliothek
(entschieden am 21.11.2026): dieselbe Lesbarkeit entsteht in einer Datei mit Vitest und Playwright.

- **Testname = Satz über das Verhalten**, auf Deutsch, aus Sicht der App oder der Forschenden: „Namen ohne Uhrzeit
  liefern nichts“, nicht „timeFromFilename null“.
- **Mehrere Fälle derselben Prüfung = Tabelle mit Spaltennamen** (`it.each` mit Tagged Template), der Testname
  setzt die Spalten ein:
  ```ts
  it.each`
    datei                        | uhrzeit
    ${"IMG_20260914_104050.jpg"} | ${"2026-09-14T10:40:50.500"}
  `("$datei ergibt $uhrzeit", ({ datei, uhrzeit }) => { … });
  ```
- **Gliederung mit Kommentaren**, sobald ein Test mehr als eine Handlung hat: `// Angenommen:` (Ausgangslage),
  `// Wenn:` (Handlung), `// Dann:` (Erwartung), jeweils mit einem kurzen Satz. Mehrere Runden im selben Test
  dürfen sich wiederholen (`// Wenn: … // Dann: … // Wenn: …`), kurze Runden auch in einer Zeile
  (`// Wenn: rückgängig, dann ist alles wie vorher`). Ein Test aus einer einzigen Prüfung braucht keine Kommentare.
- **Oberflächentests** (`apps/desktop/test/*.e2e.ts`): in kleine Abläufe mit Namen teilen,
  `await ablauf("Einen Einsatz anlegen", async () => { … })` aus `test/ablauf.ts`, darin dieselben Kommentare.
  `ablauf` druckt den Namen und nennt ihn im Fehler; was spätere Abläufe brauchen, gibt er zurück
  (`const id = await ablauf(…, async () => { …; return id; })`). Im Handbuch-Rundgang ist jedes `kapitel` selbst ein
  Ablauf.
- Kommentare beschreiben, was passiert, nicht wie der Code es macht. Ändert sich der Test, ändern sich die
  Kommentare mit.
- Pull Requests: Titel auf Deutsch und für Nutzer*innen verständlich, denn daraus entsteht das Changelog. Genau ein
  Changelog-Label setzen (prüft `.github/workflows/changelog-label.yml`, Rubriken in `.github/release.yml`).
- Labels (Namen mit Emoji, genau so schreiben). Art (Feature/Bug/Task), Priorität und Aufwand stehen in den
  Issue-Feldern von GitHub, Duplikate über den Schließgrund, nicht in Labels.
  - Changelog (an PRs, an Issues als Vorschau der Rubrik): `✨ neu`, `📈 verbessert`, `🐛 behoben`, `📖 doku`,
    `🔧 intern`, `🙈 kein-changelog`.
  - CI: `💻 alle-plattformen` prüft und baut den PR zusätzlich unter Windows und macOS (bei Pfaden, Paketierung,
    FFmpeg).
  - Bereich (Schritt der App): `📥 einsammeln`, `🔗 abgleichen`, `👀 durchsehen`, `📝 mitschreiben`, `📤 ausgeben`,
    `🧭 übersicht`.
  - Plattform (nur dort auftretend): `🪟 windows`, `🍎 macos`, `🐧 linux`.
  - Sonst: `💡 idee` (braucht erst ein Konzept), `⏳ wartet` (hängt an etwas von außen, z. B. einem Test in MAXQDA),
    `♿ barrierefreiheit`.
  - Ein Label umbenennen heißt: `.github/release.yml`, `.github/dependabot.yml` und die Workflows nachziehen.
- Versionen nie von Hand ändern: das macht der Release-Workflow (`.github/workflows/release.yml`, `scripts/release.ts`).
- README.md wird aus `README.qmd` und Bausteinen in `handbuch/` erzeugt (`vp run readme`); nie direkt bearbeiten. Neue Funktionen auch im Handbuch (`handbuch/_handbuch-*.qmd`) nachtragen.

## Modern Web Guidance

- Die Oberfläche läuft nur in Electron, also nur im mitgelieferten Chromium. **Browser-Unterstützung:** alles, was die
  Chromium-Fassung der verwendeten Electron-Version kann, auch „Newly available“ oder nur in Chromium; keine Polyfills
  und keine Rückfalllösungen für andere Browser.
- Für Oberfläche, CSS und Browser-JS den Skill `.agents/skills/modern-web-guidance` nutzen (eingebunden über
  `skills-lock.json`, für Claude Code verlinkt in `.claude/skills/`). Aktualisieren: `npx -y skills update modern-web-guidance`.
- Altlasten suchen: `DISABLE_TELEMETRY=1 npx -y modern-web-guidance@latest legacy-scan apps --json` (ebenso für
  `packages`). Ohne `DISABLE_TELEMETRY=1` schickt das Werkzeug anonyme Nutzungsdaten an Google.
- **Ausnahme Viewer** (`packages/media/src/viewer/`, Issue #122): Die HTML-Datei neben dem Montagevideo öffnen
  Forschende in irgendeinem Browser. Dort nur, was alle heutigen Browser können (Chrome, Edge, Firefox, Safari);
  Dateizugriff und WebCodecs vorher prüfen und ohne sie bei der Mischung bleiben. Das Skript (`runtime.ts`,
  `mp4-audio.ts`) wird per `Function#toString` eingebettet: keine Importe zur Laufzeit, keine Bezüge außerhalb der
  Funktion, nichts nachladen, nichts speichern außer der Freigabe in IndexedDB.
- Farben nicht auf `light-dark()` umstellen: die Canvas-Zeichnungen lesen die Farbvariablen per `getComputedStyle`
  und bekämen dann den unaufgelösten Ausdruck statt einer Farbe.
