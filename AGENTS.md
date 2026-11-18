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
- IPC-Aufrufe, die Daten ändern, mit `undoable(…, "Beschriftung", …)` anmelden (Rückgängig, `packages/core/src/db/history.ts`).
  Schreibt etwas außerhalb davon in die Projektdatei, leert das den Verlauf.
- Keine echten Forschungsdaten in Tests oder Fixtures.
- Vor dem Commit: `vp run check` und `vp run test` (die Skripte enthalten zusätzlich die Typprüfung der App).
- Pull Requests: Titel auf Deutsch und für Nutzer*innen verständlich, denn daraus entsteht das Changelog. Ein Label
  setzen: `neu`, `verbessert`, `behoben`, `doku`, `intern` oder `kein-changelog` (siehe `.github/release.yml`).
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
- Farben nicht auf `light-dark()` umstellen: die Canvas-Zeichnungen lesen die Farbvariablen per `getComputedStyle`
  und bekämen dann den unaufgelösten Ausdruck statt einer Farbe.
