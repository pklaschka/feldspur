# ADR-001: Einsatz von Effect in Feldspur

**Status:** Angenommen (Option A) · **Datum:** 20.11.2026 · **Entschieden von:** Zuri · **Umsetzung:** #134, #135, #136, #137

## Kurzfassung

Empfehlung: Effect jetzt nicht einführen, weder punktuell noch als Fundament (Option A), und stattdessen fünf kleine, gezielte Verbesserungen ohne neue Bibliothek umsetzen. Der Code hat echte Schwachstellen bei Abbruch und Aufräumen von ffmpeg-Prozessen, aber sie sitzen an wenigen, klar benennbaren Stellen in `packages/media` und lassen sich mit einem gemeinsamen Prozess-Helfer und etwa 150 bis 250 geänderten Zeilen beheben. Effect würde dieselben Stellen eleganter lösen, kostet dafür aber eine zweite Programmiersprache innerhalb von TypeScript, die Zuri als einzige Reviewerin lesen können muss. Dazu kommt der Zeitpunkt: Effect 4.0 ist erst am 01.10.2026 erschienen und hat die API gegenüber Version 3 spürbar umbenannt, sodass KI-generierter Effect-Code derzeit besonders fehleranfällig ist. Die technische Kompatibilität mit Electron ist dagegen kein Hindernis; neu prüfen sollte man die Frage, wenn Feldspur Netzwerkfunktionen, mehrere gleichzeitige Hintergrundaufträge oder eine zweite Person mit Effect-Erfahrung bekommt.

## Kontext

### Ausgangslage

Feldspur ist eine Offline-Desktop-App mit rund 28.800 Zeilen Quelltext und 8.900 Zeilen Tests (62 Testdateien, 3 E2E-Läufe). Der Quelltext verteilt sich so:

| Bereich                                 | Zeilen | Charakter                                                         |
| --------------------------------------- | -----: | ----------------------------------------------------------------- |
| `packages/core/src`                     |  3.760 | Zod-Modell, `resolveTimeline`, SQLite-Zugriff (synchron), Verlauf |
| `packages/media/src`                    |  4.811 | ffprobe/ffmpeg, Prüfsummen, Import, Ausgabe, Montagevideo         |
| `apps/desktop/src/main`                 |  3.423 | Electron-Hauptprozess, 86 IPC-Handler                             |
| `apps/desktop/src/shared` und `preload` |  1.278 | IPC-Vertrag als TypeScript-Typen                                  |
| `apps/desktop/src/renderer`             | 15.549 | React-Oberfläche                                                  |

Der Code entsteht überwiegend durch KI-Agenten; Zuri liest, prüft und merged. Die Versionen 0.1 und 0.2 sind veröffentlicht, es gibt ein Handbuch, CI und E2E-Tests.

### Korrektur einer Annahme: Electron-Version

Im Auftrag stand Electron 39. Im Repository steht inzwischen `"electron": "^45.3.2"` (`apps/desktop/package.json:29`, im Lockfile aufgelöst auf 45.3.2). `pdfjs-dist` ist exakt auf 6.5.438 festgelegt (`apps/desktop/package.json:20`); das ist zugleich die aktuell neueste Version auf npm, und im Repository steht kein Kommentar zum Grund der Festlegung. Ich habe deshalb beide Electron-Stände geprüft:

| Electron | Chromium       | Node.js | Quelle                                           |
| -------- | -------------- | ------- | ------------------------------------------------ |
| 39.0.0   | 142.0.7444.52  | 22.20.0 | `DEPS`-Datei im Electron-Repository, Tag v39.0.0 |
| 45.3.2   | 156.0.8078.100 | 24.22.2 | `DEPS`-Datei im Electron-Repository, Tag v45.3.2 |

### Stand von Effect (am 20.11.2026 in der npm-Registry geprüft)

- `effect` 4.1.5 ist die aktuelle Version (`latest`), 3.22.5 läuft als `prev` weiter. Version 4.0.0 erschien am 01.10.2026, ist also sieben Wochen alt; seither gab es dreizehn weitere Veröffentlichungen in der 4er-Linie.
- `@effect/schema` ist als veraltet markiert („merged into the main effect package“). In Version 4 stecken auch Kindprozesse (`effect/process`), SQL (`effect/sql`) und RPC (`effect/rpc`) im Hauptpaket; für Node braucht man zusätzlich `@effect/platform-node` 4.1.5. Das alte `@effect/platform` (0.97.2) gehört zur 3er-Linie.
- Die API hat sich zwischen 3 und 4 sichtbar geändert. In den Typdefinitionen von 4.1.5 gibt es zum Beispiel `Effect.catchAll` und `Effect.fork` nicht mehr (dafür unter anderem `Effect.forkChild`), das Modul `Either` fehlt (dafür `Result`), und Dienste werden mit `Context.Service` deklariert statt mit `Context.Tag` oder `Effect.Service`.
- Kompatibilität: Das Paket hat kein `engines`-Feld und keine Laufzeitabhängigkeiten. Eine Suche im ausgelieferten Code nach neueren JavaScript-Funktionen (`Promise.try`, `Error.isError`, `using`-Deklarationen, `Temporal`, `getOrInsert`, `DisposableStack`) ergab keine Treffer; `Uint8Array.fromBase64` wird nur nach vorheriger Prüfung benutzt (`dist/internal/base64.js:22`). Effect 4.1.5 sollte daher sowohl mit Electron 39 als auch mit Electron 45 laufen. Das ist eine statische Prüfung des Pakets, kein Testlauf in der App.
- Das Paket ist ausschließlich ESM. Der Hauptprozess wird mit tsdown als CommonJS gebündelt (`apps/desktop/vite.config.ts:12`), was beim Bündeln aufgelöst wird und voraussichtlich kein Problem ist. Entpackt ist `effect` 64 MB groß; gebündelt wird nur das Benutzte, und die Paketgröße ist bei Electron ohnehin zweitrangig.
- Bemerkenswert: Das Paket liefert eine eigene `AGENTS.md` und einen Ordner `ai-docs` mit Beispielen für KI-Agenten mit. Das mildert das Problem veralteter Trainingsdaten, hebt es aber nicht auf (siehe Abwägung).

### Wo der Code heute Schwächen hat, die Effect adressieren würde

**1. Nebenläufigkeit und Abbruch (der stärkste Befund).** Abbruch wird durchgehend über `AbortSignal` von Hand durchgereicht: 63 Fundstellen in 13 Dateien. Das funktioniert an den meisten Stellen, hat aber Lücken:

- Die eigene Warteschlange `pool` in `packages/media/src/montage-video.ts:353-374` startet nach einem Fehler keine neuen Abschnitte mehr, bricht die laufenden aber nicht ab. Der Kommentar sagt es selbst: „laufende werden noch abgewartet, dann kommt der erste Fehler“. Scheitert ein Abschnitt, rechnen bis zu drei weitere ffmpeg-Prozesse ihren Abschnitt (bis zu 60 Sekunden Video) zu Ende, bevor die Fehlermeldung erscheint.
- Der Ton läuft neben dem Bild als nicht abgewartetes Promise (`audioDone`, `montage-video.ts:500-523`). Scheitert die Bildberechnung ohne Abbruch durch die Nutzerin, kehrt `renderMontage` zurück, während die Ton-Prozesse weiterlaufen. Danach löscht `exportSession` den Arbeitsordner (`packages/media/src/export.ts:344`), in den diese Prozesse noch schreiben. Die mehrfachen Löschversuche mit verschluckten Fehlern an dieser Stelle sind vermutlich teilweise eine Folge davon.
- Mehrere Kindprozesse bekommen das Signal gar nicht: die Pegelmessung vor der Ausgabe (`packages/media/src/analyze.ts:153`, aufgerufen in `analyze.ts:188`), die Standbilder (`packages/media/src/stills.ts:64`) und die Tonspur-Prüfung im Montagevideo (`montage-video.ts:407`). Ein Abbruch während „Lautstärke messen“ wartet also, bis die laufende Datei vollständig dekodiert ist.
- Die Tonspur-Analyse (`analyzeSession`, `analyze.ts:45-90`, IPC-Handler in `apps/desktop/src/main/main.ts:670-687`) ist überhaupt nicht abbrechbar. Anders als beim Einsammeln (`main.ts:449`) prüft der Handler auch nicht, ob währenddessen das Projekt gewechselt wurde; `openStore` sperrt nur bei laufender Ausgabe (`main.ts:167`). Das sollte unabhängig von dieser Entscheidung geprüft werden.
- Die Brücke zur Oberfläche für Einblendungen und Standbilder (`apps/desktop/src/main/export.ts:52-94`) hält offene Promises in einer Map, ohne Zeitlimit und ohne Verbindung zum Abbruchsignal. Stürzt die Oberfläche während einer Ausgabe ab oder wird neu geladen, bleibt die Ausgabe hängen, und `running` (`export.ts:28`) verhindert jede weitere Ausgabe bis zum Neustart.
- Es gibt keinerlei Zeitlimit oder Stillstandserkennung für Kindprozesse (keine Fundstelle für `timeout` bei Prozessen). Ein ffprobe, das an einer defekten Datei oder einem schlafenden Netzlaufwerk hängt, hängt für immer. Hinweis zum Begriff: Der „Wachhund“ im Code (`packages/media/src/audio.ts:121`) ist ein Fachmerkmal, nämlich laute Stellen in der Stille, und kein Prozesswächter.

**2. Prozessaufrufe sind mehrfach von Hand gebaut.** Es gibt drei eigenständige `spawn`-Hüllen mit eigener stderr-Sammlung und eigenem Fehlertext (`montage-video.ts:98-123`, `audio.ts:28-78`, `waveform.ts:27-95`) und drei Dateien mit `promisify(execFile)` (`montage-video.ts:33`, `probe.ts:10`, `stills.ts:13`). Die Fehlermeldungen sind uneinheitlich (`ffmpeg: …` gegenüber `ffmpeg (code): erste Zeile`).

**3. Fehlerbehandlung.** Fehler werden geworfen: 141 `throw new` in 28 Dateien, 73 `try`-Blöcke in 35 Dateien, eine einzige eigene Fehlerklasse (`ExportPrecheckError`, `packages/media/src/write-check.ts:12`). Typische Folgen:

- An sechs Stellen wird ein Fehler gefangen und dann am Signal nachgesehen, ob es eigentlich ein Abbruch war (`apps/desktop/src/main/export.ts:190` und `:216`, `main.ts:441`, `packages/media/src/integrity.ts:156`, `import.ts:209` und `:289`).
- Über die IPC-Grenze gehen Fehlerklassen verloren. Die Oberfläche schneidet Electrons Präfix per regulärem Ausdruck ab, und zwar an zwei Stellen gleichlautend (`apps/desktop/src/renderer/App.tsx:62`, `apps/desktop/src/renderer/exportState.tsx:95`).
- Einige Fehler werden bewusst verschluckt, zum Beispiel `catch(() => null)` bei der Pegelmessung (`analyze.ts:188`) und beim Standbild aus der Oberfläche (`export.ts:224`).

Dem steht gegenüber, dass der Code erwartbare Fehlschläge bereits als Rückgabewerte modelliert, wo es zählt: `{ ok: true } | { ok: false, problem }` in `packages/core/src/db/backup.ts:127`, `VerifyResult` in `packages/media/src/integrity.ts:173`, und das Ergebnis der Ausgabe als `{ cancelled } | { originals } | { dir, files }` (`apps/desktop/src/main/export.ts:173-230`). Die Fehlermeldungen sind durchweg deutsch und für Nutzerinnen formuliert. Das ist ein gesundes Muster, kein Wildwuchs.

**4. Ressourcen aufräumen.** Es gibt genau ein temporäres Verzeichnis (`mkdtemp` in `packages/media/src/export.ts:270`), aufgeräumt per `try/finally` (`export.ts:340-344`). Dazu kommen Aufräumschritte im Montagevideo mit Wiederholung und verschluckten Fehlern (`montage-video.ts:633`, `:687`). Die Wiederholungen nutzen die in Node eingebauten Optionen `maxRetries` und `retryDelay`. Das Aufräumen selbst ist überschaubar; das Problem ist die Reihenfolge (Aufräumen, während Prozesse noch laufen, siehe Punkt 1).

**5. Dependency Injection und Testbarkeit.** Globaler Zustand existiert an drei Stellen: die Werkzeugpfade (`packages/media/src/tools.ts:11`), die laufende Ausgabe (`apps/desktop/src/main/export.ts:28-29`) und das offene Projekt (`apps/desktop/src/main/main.ts:109`). In der Praxis stört das kaum: Die Tests arbeiten mit echtem ffmpeg und erzeugten Fixtures und kommen mit drei `vi.mock`-Aufrufen aus (`packages/media/test/write-check-gesperrt.test.ts:4`, `apps/desktop/test/export-cancel.test.ts:12`, `apps/desktop/test/export-originals-check.test.ts:16`). Funktionen nehmen den `ProjectStore` als Parameter entgegen, was bereits schlichte Dependency Injection ist.

**6. Validierung.** Zod wird konzentriert und sinnvoll eingesetzt: Nur zwei Dateien importieren es. `packages/core/src/model.ts` enthält das Modell (380 Zeilen, rund 150 Zod-Ausdrücke), `packages/core/src/db/store.ts` validiert an 40 Stellen jede Zeile beim Lesen und Schreiben (zum Beispiel `store.ts:156-177`). Die abgeleiteten Typen (`z.infer`) werden im ganzen Projekt benutzt. Hier gibt es keinen Schmerzpunkt.

**7. IPC-Grenze.** 86 Handler (36 direkt, 50 über `undoable`), der Vertrag steht als TypeScript-Typen in `apps/desktop/src/shared/api.ts` (931 Zeilen). Argumente werden zur Laufzeit nicht geprüft (zum Beispiel `main.ts:421`). Da Haupt- und Oberflächenprozess aus demselben Build stammen und die App offline läuft, ist das vertretbar. `undoable` (`main.ts:206-218`) ist bewusst synchron: Der Handler läuft vollständig in einer SQLite-Transaktion (`packages/core/src/db/history.ts:223-231`).

**8. Wiederholungen und Zeitlimits.** Wiederholungen gibt es nur beim Löschen von Dateien (siehe Punkt 4). Netzwerkzugriffe, bei denen Wiederholungsstrategien ihren eigentlichen Nutzen hätten, gibt es nicht.

### Zusammenfassung des Befunds

Die Stärken von Effect (strukturierte Nebenläufigkeit, Unterbrechung, Ressourcen-Scopes) treffen auf ein reales Problem, aber nur in einem schmalen Bereich: Betroffen sind zehn Dateien in `packages/media` mit zusammen 2.725 Zeilen, davon geschätzt 800 bis 1.200 Zeilen Ablaufsteuerung. Der übrige Code (synchroner SQLite-Zugriff, reine Berechnung in `resolve.ts`, React-Oberfläche) hat die Probleme nicht, die Effect löst.

## Optionen

Die Aufwandsangaben sind Schätzungen. Sie gehen davon aus, dass Agenten den Code schreiben und der Engpass Zuris Prüfzeit ist.

### Option A: Kein Effect, gezielte Verbesserungen ohne neue Bibliothek

Der Code bleibt bei `async/await`, `AbortSignal` und `try/finally`. Die Befunde aus Punkt 1 und 2 werden mit einem gemeinsamen Helfer behoben (Einzelheiten unter „Nächste Schritte“).

| Kriterium                   | Bewertung                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Komplexität                 | Niedrig. Keine neuen Konzepte, ein neuer Helfer von geschätzt 60 bis 100 Zeilen.                          |
| Aufwand                     | Fünf kleine Pull Requests, zusammen etwa 150 bis 250 geänderte Zeilen plus Tests. Prüfzeit: etwa ein Tag. |
| Nutzen                      | Behebt alle unter Punkt 1 und 2 genannten Lücken. Fehlertypen bleiben unsichtbar für den Compiler.        |
| Vertrautheit und Lesbarkeit | Hoch. Gleicher Stil wie die bisherigen 126 Pull Requests.                                                 |
| Risiko                      | Niedrig. Jede Änderung ist lokal und einzeln testbar (es gibt bereits `export-cancel.test.ts`).           |

**Dafür spricht:** Die Lösung ist proportional zum Problem. Zuri kann jede Zeile weiterhin selbst beurteilen. Agenten schreiben diesen Stil zuverlässig, weil er dem entspricht, was Node dokumentiert. Die bestehenden Tests bleiben gültig.

**Dagegen spricht:** Die Disziplin bleibt Handarbeit. Wer künftig einen neuen Prozessaufruf schreibt, muss an Signal und Helfer denken; der Compiler erzwingt es nicht. Das lässt sich mit einer Zeile in `AGENTS.md` und einer Lint-Regel (kein direkter Import von `node:child_process` außerhalb des Helfers) weitgehend auffangen.

### Option B: Effect punktuell in `packages/media`, Promise-Grenze nach außen

Die Ablaufsteuerung von Import, Prüfung, Analyse und Ausgabe wird in Effect geschrieben. Öffentliche Funktionen wie `exportSession` behalten ihre Signatur und rufen intern `Effect.runPromise(…, { signal })` auf.

| Kriterium                   | Bewertung                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Komplexität                 | Mittel bis hoch. Zwei Stile im selben Paket, eine Grenze, an der Abbruch, Fehler und Fortschritt übersetzt werden müssen.                                                                                                             |
| Aufwand                     | 6 bis 10 Pull Requests, 800 bis 1.200 neu geschriebene Zeilen, dazu Anpassung der Media-Tests. Prüfzeit: 3 bis 5 Tage, zuzüglich ein bis zwei Wochen Einarbeitung für Zuri.                                                           |
| Nutzen                      | Abbruch und Aufräumen sind konstruktionsbedingt korrekt: Scheitert ein Abschnitt, werden Geschwister und Ton unterbrochen, und der Arbeitsordner wird erst danach gelöscht. Zeitlimits und begrenzte Parallelität sind je eine Zeile. |
| Vertrautheit und Lesbarkeit | Niedrig. Generatoren mit `yield*`, `pipe`, Layer und Fehlerkanäle sind für Leserinnen ohne Effect-Erfahrung schwer zu prüfen.                                                                                                         |
| Risiko                      | Mittel. Betroffen ist die Ausgabe, also die Funktion, deren Ergebnis in die Forschung eingeht. Die API ist sieben Wochen alt.                                                                                                         |

**Dafür spricht:** Hier sitzt der tatsächliche Schmerz, und Effect ist genau dafür gebaut. Die eigene Warteschlange `pool`, die Promise-Hüllen um `spawn` und das händische Durchreichen des Signals entfielen.

**Dagegen spricht:** Der Gewinn gegenüber Option A ist klein, weil die Lücken endlich und bekannt sind. Dafür entsteht ein Paket, das Zuri nicht mehr mit derselben Sicherheit prüfen kann wie den Rest. Die Kernlogik in `renderMontage` besteht überwiegend aus ffmpeg-Argumenten und Zwischenspeicher-Schlüsseln (`montage-video.ts:536-638`); Effect macht diesen Teil nicht einfacher, sondern rückt ihn nur ein. Der `ProjectStore` wird mitten in den Abläufen synchron benutzt (zum Beispiel `analyze.ts:155`), was in Effect zwar geht, aber die Grenze zwischen beiden Welten durch jede Funktion zieht.

Zur Einschätzung der Lesbarkeit ein Vergleich. So sieht der ffprobe-Aufruf heute aus (`packages/media/src/probe.ts:28-34`, gekürzt):

```ts
const { stdout } = await run(toolPaths().ffprobe, [...args, path], { maxBuffer: 16 << 20, signal: opts.signal });
const j = JSON.parse(stdout) as FfprobeJson;
```

So sähe derselbe Aufruf in Effect 4 aus. Die Form folgt dem Beispiel, das im Paket mitgeliefert wird (`ai-docs/src/60_child-process/10_working-with-child-processes.ts`); sie ist nicht gegen Feldspur kompiliert:

```ts
const probe = Effect.fn("probeMedia")(function* (path: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdout = yield* spawner.string(ChildProcess.make(ffprobe, [...args, path])).pipe(
    Effect.timeout("30 seconds"),
    Effect.mapError((cause) => new ProbeError({ path, cause })),
  );
  return yield* Schema.decodeUnknown(FfprobeJson)(JSON.parse(stdout));
});
```

Die zweite Fassung kann mehr (Zeitlimit, typisierter Fehler, geprüfte Ausgabe, automatische Unterbrechung). Sie verlangt von der Leserin aber, sechs Konzepte zu kennen, die in der ersten nicht vorkommen.

### Option C: Effect als durchgängiges Fundament

Dienste und Layer für Projekt, Werkzeuge und Dateisystem; Effect Schema statt Zod; Effect in allen IPC-Handlern, gegebenenfalls `effect/rpc` und `effect/sql`.

| Kriterium                   | Bewertung                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Komplexität                 | Sehr hoch. Praktisch eine Neuschreibung von allem außerhalb der Oberfläche.                                                                                                                                              |
| Aufwand                     | Rund 13.300 Zeilen Produktionscode (`core`, `media`, `main`, `shared`, `preload`) und der Großteil der 8.900 Testzeilen. Geschätzt 40 bis 60 Pull Requests über mehrere Monate, in denen kaum neue Funktionen entstehen. |
| Nutzen                      | Einheitliches Fehler- und Dienstmodell, typisierte Fehler bis zur Oberfläche. Für Nutzerinnen ändert sich nichts Sichtbares.                                                                                             |
| Vertrautheit und Lesbarkeit | Sehr niedrig. Zuri müsste Effect so gut beherrschen wie heute TypeScript.                                                                                                                                                |
| Risiko                      | Hoch. Datenmodell, Migrationen und Verlauf sind die Teile, in denen ein Fehler Forschungsdaten kostet.                                                                                                                   |

**Dafür spricht:** Konsistenz. Wenn schon Effect, dann ist ein durchgängiger Einsatz langfristig sauberer als eine Insel.

**Dagegen spricht:** Fast alles andere.

- _SQLite ist synchron._ `history.record` verlangt eine synchrone Funktion innerhalb einer better-sqlite3-Transaktion (`packages/core/src/db/history.ts:223-231`). Die Regel aus `AGENTS.md`, dass jede ändernde IPC-Aktion ein Schritt im Verlauf ist, beruht darauf. Ein Effect-Handler dürfte innerhalb dieser Transaktion nichts Asynchrones tun; man müsste `Effect.runSync` im Transaktions-Callback aufrufen und sicherstellen, dass kein Effekt darin je asynchron wird. Diese Zusage prüft der Compiler nicht. Die Alternative, auf `effect/sql` umzusteigen, hieße, den Verlauf mit seinen temporären Triggern auf einer anderen Verbindungsschicht neu abzusichern. Ob es für Drizzle 0.45 eine tragfähige Anbindung an Effect 4 gibt, habe ich nicht geprüft; das ist eine offene Annahme.
- _Zod ersetzen bringt nichts._ Das Modell ist klein, gut kommentiert und an genau zwei Stellen eingebunden. Ein Wechsel auf Effect Schema würde jede der 40 Parse-Stellen und alle abgeleiteten Typen anfassen, ohne ein bestehendes Problem zu lösen. Zod 4 ist zudem für Agenten sehr vertrautes Terrain.
- _React profitiert nicht._ Die Oberfläche ruft `api.*` auf und erhält Promises; in den 15.500 Zeilen gibt es keinen einzigen `AbortController`. Effect in der Oberfläche würde nur die Einstiegshürde erhöhen.
- _Die IPC-Grenze ist intern._ `effect/rpc` löst Versions- und Vertrauensprobleme zwischen getrennten Systemen. Haupt- und Oberflächenprozess von Feldspur entstehen im selben Build.
- _Migrationsrisiko bei laufenden Releases._ Während der Umstellung müssten Hotfixes für 0.2.x in altem und neuem Stil gepflegt werden.

### Option D: Leichtere Bibliotheken

Gemeint sind `neverthrow` oder ein eigener `Result`-Typ für Fehler, `p-limit` für begrenzte Parallelität, `execa` für Prozesse.

| Kriterium                   | Bewertung                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Komplexität                 | Niedrig bis mittel, je nach Umfang.                                                                                                                                                                    |
| Aufwand                     | `p-limit` oder `execa`: je ein Pull Request. `neverthrow` flächig: ähnlich invasiv wie Option B, weil 141 `throw`-Stellen betroffen wären.                                                             |
| Nutzen                      | Gering. `p-limit` ersetzt 22 Zeilen eigene Warteschlange, löst aber das Abbrechen der Geschwister nicht. `execa` vereinheitlicht Prozessaufrufe, was der eigene Helfer aus Option A ebenfalls leistet. |
| Vertrautheit und Lesbarkeit | `p-limit` und `execa`: hoch. `neverthrow`: mittel.                                                                                                                                                     |
| Risiko                      | Niedrig, aber jede Abhängigkeit kostet Pflege (Lizenzliste in `packaging/THIRD-PARTY.md`, Dependabot).                                                                                                 |

**Dafür spricht:** `execa` wäre eine vertretbare Alternative zum eigenen Helfer, falls man ihn nicht selbst pflegen möchte.

**Dagegen spricht:** Der Code nutzt für erwartbare Fehlschläge bereits eigene Vereinigungstypen, die besser lesbar sind als eine `Result`-Bibliothek. Die eigentliche Lücke (Abbruch der Geschwister, Reihenfolge beim Aufräumen) schließt keine dieser Bibliotheken von selbst. Für den Bedarf von Feldspur reichen `AbortSignal.any`, `AbortSignal.timeout` und `try/finally` aus der Plattform.

## Abwägung

**Der Nutzen ist real, aber schmal.** Von den acht untersuchten Feldern hat nur eines (Nebenläufigkeit und Abbruch) Befunde, die Fehler im Verhalten sind. Sie betreffen eine Handvoll Stellen. Ein Werkzeug, das die gesamte Programmierweise ändert, ist dafür überdimensioniert.

**Die Lesbarkeit für die Reviewerin ist das entscheidende Kriterium.** In diesem Projekt ist das Review die wichtigste Qualitätssicherung, denn den Code schreibt eine KI. Jede Technik, die Zuris Fähigkeit senkt, einen Fehler im Diff zu erkennen, senkt die Qualität des Ganzen, auch wenn sie einzelne Fehlerklassen ausschließt. Effect verlagert viel Bedeutung in Typparameter und Kombinatoren; ein vergessenes `yield*` oder ein Effekt, der gebaut, aber nie ausgeführt wird, fällt im Diff nicht auf. Ein vergessenes `signal` fällt dagegen auf, sobald man weiß, dass man danach suchen muss.

**Der Zeitpunkt ist ungünstig für KI-generierten Effect-Code.** Version 4 ist sieben Wochen alt und erscheint derzeit etwa zweimal pro Woche neu. Die Trainingsdaten der Modelle bestehen überwiegend aus Code für Version 2 und 3 sowie aus Vorabversionen von 4, deren Benennungen sich bis zur Veröffentlichung noch geändert haben. Das Risiko ist nicht, dass ein Agent gar keinen Effect-Code schreiben kann, sondern dass er plausibel aussehende Aufrufe aus Version 3 verwendet (`Effect.catchAll`, `Either`, `Context.Tag`), die Typprüfung sie abweist und er sich dann durch Ausprobieren zu einer Lösung arbeitet, die kompiliert, aber nicht idiomatisch ist. Die mitgelieferten `ai-docs` helfen dagegen; sie ersetzen aber keine Reviewerin, die beurteilen kann, ob das Ergebnis gut ist. Bei Version 3 zu bleiben wäre keine Lösung, weil das Paket `@effect/schema` schon abgekündigt ist und man die Migration auf 4 nur verschöbe.

**Technische Hürden gibt es keine, die den Ausschlag gäben.** Effect läuft nach der statischen Prüfung mit Electron 39 wie mit Electron 45, und die Paketgröße spielt keine Rolle. Die Entscheidung fällt also nicht an der Machbarkeit, sondern am Verhältnis von Nutzen zu dauerhaften Kosten.

**Option B ist die einzige ernsthafte Alternative zu A.** Sie setzt Effect dort ein, wo es passt, und hält den Rest unberührt. Gegen sie spricht, dass eine Insel in einem anderen Stil für ein Ein-Personen-Projekt teurer ist als für ein Team: Es gibt niemanden, der sich auf diesen Teil spezialisieren könnte. Außerdem bleibt nach Option A kaum ein Restproblem übrig, das B noch lösen müsste.

## Empfehlung und Folgen

**Empfehlung: Option A.** Kein Effect, dafür die fünf Verbesserungen aus den nächsten Schritten. Option D nur insofern, als `execa` den eigenen Helfer ersetzen dürfte, falls das bevorzugt wird; nötig ist es nicht. Option C wird ausdrücklich verworfen.

**Was dadurch leichter wird**

- Abbruch und Fehler im Montagevideo verhalten sich vorhersehbar: Ein Fehler oder Abbruch beendet alle zugehörigen Prozesse, bevor aufgeräumt wird.
- Prozessaufrufe haben eine einzige Stelle für Signal, Zeitlimit, Fehlertext und (in Tests) Austausch des Werkzeugs.
- Zuri prüft weiterhin Code in einem einzigen, vertrauten Stil.

**Was schwerer bleibt**

- Fehlertypen stehen nicht in den Signaturen. Welche Funktion was werfen kann, steht weiterhin in Kommentaren und Tests.
- Die Regel „jeder Kindprozess über den Helfer, jedes Signal durchreichen“ muss durch `AGENTS.md`, eine Lint-Regel und Review gehalten werden.
- Sollte später doch Effect kommen, ist die Arbeit aus Option A nicht verloren: Ein zentraler Helfer ist genau die Stelle, an der man umstellen würde.

**Wann die Frage neu zu prüfen ist.** Effect (dann als Option B, beginnend mit einem Probelauf am Montagevideo) lohnt eine neue Bewertung, wenn mindestens eines der folgenden Kriterien eintritt:

1. Feldspur bekommt Netzwerkfunktionen, etwa Synchronisation, Hochladen oder einen Transkriptionsdienst, bei denen Wiederholungen, Zeitlimits und Ratenbegrenzung zum Alltag gehören.
2. Es sollen mehrere Hintergrundaufträge gleichzeitig laufen oder Aufträge pausiert, fortgesetzt und in eine Warteschlange gestellt werden. Heute gilt bewusst „eine Ausgabe nach der anderen“ (`apps/desktop/src/main/export.ts:174`).
3. Trotz des gemeinsamen Helfers treten weiter Fehler der Klasse „verwaister Prozess, ignorierter Abbruch, nicht aufgeräumte Datei“ auf; als Schwelle schlage ich drei solche Fehlerberichte innerhalb von sechs Monaten vor.
4. Eine zweite Person mit Effect-Erfahrung arbeitet regelmäßig mit, oder Zuri möchte Effect aus eigenem Interesse lernen.
5. Effect 4 ist seit etwa einem Jahr stabil, und ein Probeauftrag zeigt, dass Agenten idiomatischen Code für Version 4 ohne Rückgriffe auf Version 3 schreiben.

Frühester sinnvoller Termin für eine Wiedervorlage ist aus meiner Sicht das vierte Quartal 2027.

## Nächste Schritte

- [ ] Entscheidung treffen und diesen ADR mit Status „Angenommen“ oder „Abgelehnt“ ins Repository legen (Vorschlag: `docs/adr/001-effect.md`, Label `intern`).
- [ ] **Prozess-Helfer:** Eine Funktion in `packages/media/src/tools.ts` oder einer neuen Datei daneben, die ffmpeg und ffprobe startet, stderr begrenzt sammelt, einheitliche Fehlertexte erzeugt, ein `AbortSignal` verlangt und optional ein Zeitlimit beziehungsweise eine Stillstandserkennung bietet. Die Aufrufe in `montage-video.ts:98-130`, `audio.ts:28-78`, `waveform.ts:27-95`, `probe.ts:28`, `stills.ts:64` darauf umstellen.
- [ ] **Signal-Lücken schließen:** `measureSource` und `sessionLevels` (`analyze.ts:151-193`), `renderStill` (`stills.ts:47-83`) und `hasSound` (`montage-video.ts:403-414`) reichen das Signal durch. `analyzeSession` wird abbrechbar; der Handler in `main.ts:670-687` prüft wie beim Einsammeln, ob das Projekt gewechselt wurde.
- [ ] **Montagevideo:** `renderMontage` legt einen inneren `AbortController` an, der mit dem äußeren Signal verbunden ist (`AbortSignal.any`). Scheitert ein Abschnitt, bricht er die übrigen Abschnitte und den Ton ab. `audioDone` wird in jedem Fall abgewartet, bevor die Funktion zurückkehrt. Dazu ein Test, der einen Abschnitt scheitern lässt und prüft, dass danach kein ffmpeg mehr läuft.
- [ ] **Brücke zur Oberfläche:** Offene Anfragen in `apps/desktop/src/main/export.ts:52-94` werden bei Abbruch, bei zerstörtem Fenster (`render-process-gone`) und nach einem Zeitlimit abgelehnt.
- [ ] **Fehlertext über IPC:** Das Abschneiden des Electron-Präfixes an einer Stelle bündeln (zum Beispiel im Preload), statt in `App.tsx:62` und `exportState.tsx:95` getrennt.
- [ ] **Absichern:** In `AGENTS.md` eine Zeile ergänzen („Kindprozesse nur über den Helfer starten, `signal` immer durchreichen“) und eine Lint-Regel einrichten, die den direkten Import von `node:child_process` außerhalb des Helfers verbietet.
- [ ] Wiedervorlage dieses ADR eintragen (Vorschlag: Oktober 2027, oder früher bei einem der fünf Kriterien).

---

_Grundlage:_ Stand des Repositorys bei Commit `c5f7e1e` vom 19.11.2026. Versionsangaben zu Effect und Electron wurden am 20.11.2026 in der npm-Registry und im Electron-Repository nachgesehen. Aufwände sind Schätzungen; die Aussagen zur Kompatibilität beruhen auf einer Durchsicht des Pakets `effect` 4.1.5, nicht auf einem Testlauf in der App. Die unter „Kontext“ genannten Schwachstellen sind aus dem Quelltext gelesen und nicht durch Ausführen reproduziert.
