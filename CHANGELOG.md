# Changelog

Änderungen an der Feldspur-App. Die Einträge entstehen beim Release automatisch aus den Titeln der
zusammengeführten Pull Requests (siehe `.github/release.yml` für die Rubriken). Vorabversionen (`-rc.N` usw.)
werden beim zugehörigen Release zu einem Abschnitt zusammengefasst.

## 0.1.0 – 2026-11-16

<!-- Release notes generated using configuration in .github/release.yml at c2dc50091180240e9ecb272e8df982af3746e64f -->

### Neu

- Release-Workflow mit Vorabversionen und Changelog, App-Symbol, EUPL-1.2 ([#27](https://github.com/pklaschka/feldspur/pull/27), @pklaschka)
- Rückgängig und Wiederholen (Strg+Z) statt Nachfragen beim Löschen ([#36](https://github.com/pklaschka/feldspur/pull/36), @pklaschka)
- Episoden von Hand anpassen: Grenzen ziehen, Mini-Episoden, Wellenform in den Spuren ([#37](https://github.com/pklaschka/feldspur/pull/37), @pklaschka)
- Dokumentvariablen für MAXQDA beim Ausgeben ([#38](https://github.com/pklaschka/feldspur/pull/38), @pklaschka)
- Dauerhaftes Änderungsprotokoll in der Projektdatei ([#40](https://github.com/pklaschka/feldspur/pull/40), @pklaschka)
- Projektdateien per Doppelklick öffnen, mit eigenem Dateisymbol ([#47](https://github.com/pklaschka/feldspur/pull/47), @pklaschka)

### Verbessert

- Mitschreiben mit Tastenkürzeln überall und Zeilen paralleler Spuren, Seitenzählung für Tagebuch-Doppelseiten ([#30](https://github.com/pklaschka/feldspur/pull/30), @pklaschka)
- Wärmer und klarer: Feldbuch-Design, bessere Abläufe, Handbuch für den Druck ([#29](https://github.com/pklaschka/feldspur/pull/29), @pklaschka)
- Tagebuch abtippen: Uhrzeit als Maskenfeld, zoombare Seiten, Blättern mit Bild auf/ab ([#33](https://github.com/pklaschka/feldspur/pull/33), @pklaschka)
- Projektwahl gut erkennbar, einheitliche Hinweise an den Schritten, Mitschrift-Treffer öffnen das Mitschreiben ([#35](https://github.com/pklaschka/feldspur/pull/35), @pklaschka)

### Behoben

- Zeitachse: Hinweiskarten nicht mehr abgeschnitten, Zeichnen ohne Flackern ([#32](https://github.com/pklaschka/feldspur/pull/32), @pklaschka)

### Dokumentation

- Begleittext und Handbuch als Webseite und PDF, README daraus erzeugt ([#28](https://github.com/pklaschka/feldspur/pull/28), @pklaschka)
- Handbuch: welche Formate Feldspur direkt zeigt und welche man umwandelt ([#39](https://github.com/pklaschka/feldspur/pull/39), @pklaschka)
- Zitierangaben mit Stand, PURLs in den Metadaten, Empfehlung zum Zitieren ([#41](https://github.com/pklaschka/feldspur/pull/41), @pklaschka)

### Hinter den Kulissen

- CodeQL-Funde beheben oder begründet schließen ([#42](https://github.com/pklaschka/feldspur/pull/42), @pklaschka)
- Release pusht mit Deploy-Schlüssel auf main ([#45](https://github.com/pklaschka/feldspur/pull/45), @pklaschka)

### Weitere Änderungen

- Grundgerüst, Datenmodell, Import und Zeitbestimmung ([#1](https://github.com/pklaschka/feldspur/pull/1), @pklaschka)
- Oberfläche auf Tailwind und Radix, Zeitachse auf Canvas ([#5](https://github.com/pklaschka/feldspur/pull/5), @pklaschka)
- Zeiten von Hand: Uhrzeit, Ansage, Anker ([#6](https://github.com/pklaschka/feldspur/pull/6), @pklaschka)
- Wiedergabe: abspielen, spulen, Stellen übernehmen ([#7](https://github.com/pklaschka/feldspur/pull/7), @pklaschka)
- Tagebuch abtippen: Einträge als Rahmen auf Scanseiten ([#8](https://github.com/pklaschka/feldspur/pull/8), @pklaschka)
- Design überarbeitet: Schrittköpfe, Zeitachse, Detailleiste, Kontraste ([#9](https://github.com/pklaschka/feldspur/pull/9), @pklaschka)
- Installationspaket mit LGPL-FFmpeg ([#10](https://github.com/pklaschka/feldspur/pull/10), @pklaschka)
- README: Forschungswerkzeug, KI-Entstehung und Zitierangaben ([#11](https://github.com/pklaschka/feldspur/pull/11), @pklaschka)
- Quellen pflegen, PDF-Scans, Folgeaufnahmen, Einsatzdaten, große Vorschau ([#12](https://github.com/pklaschka/feldspur/pull/12), @pklaschka)
- Mitschreiben im Tool ([#13](https://github.com/pklaschka/feldspur/pull/13), @pklaschka)
- UTC-Zeitstempel in Metadaten richtig lesen ([#14](https://github.com/pklaschka/feldspur/pull/14), @pklaschka)
- Ausgeben: Montagevideo und Zeitgerüst für MAXQDA ([#15](https://github.com/pklaschka/feldspur/pull/15), @pklaschka)
- Zeitzone je Gerät, lange Uhrabweichungen, Geräteuhr aus einem Clip ([#16](https://github.com/pklaschka/feldspur/pull/16), @pklaschka)
- Werkzeuge: Export im Hintergrund, Whisper-Import, Suche, Montage-Vorschau, schnellerer Export ([#17](https://github.com/pklaschka/feldspur/pull/17), @pklaschka)
- Montage: Videos nebeneinander, Ton gemischt, Tagebuch mit Abschrift; Seitenleisten verstellbar ([#18](https://github.com/pklaschka/feldspur/pull/18), @pklaschka)
- Zuletzt geöffnete Projekte schnell öffnen ([#19](https://github.com/pklaschka/feldspur/pull/19), @pklaschka)
- Tagebuchnotizen an der Notierzeit zeigen ([#20](https://github.com/pklaschka/feldspur/pull/20), @pklaschka)
- Montagevideo nur noch zum Zuordnen, wahlweise in Echtzeit ([#21](https://github.com/pklaschka/feldspur/pull/21), @pklaschka)
- Echtzeit: Uhrzeit läuft auch zwischen den Episoden weiter ([#22](https://github.com/pklaschka/feldspur/pull/22), @pklaschka)
- Episoden nur auf Wunsch, Ausgabe standardmäßig in Echtzeit ([#23](https://github.com/pklaschka/feldspur/pull/23), @pklaschka)
- Zeitachse: Lagen prüfen, Textvorschau, Zoom an der Maus ([#24](https://github.com/pklaschka/feldspur/pull/24), @pklaschka)
- Mitschreiben: Waveform, lange Mitschriften, Notizen zu Dateien ([#25](https://github.com/pklaschka/feldspur/pull/25), @pklaschka)
- Lautstärke angleichen und Feinabgleich zweier Tonspuren ([#26](https://github.com/pklaschka/feldspur/pull/26), @pklaschka)
- Bildschirmfotos nach dem Redesign erneuern ([#31](https://github.com/pklaschka/feldspur/pull/31), @pklaschka)
- Release zieht Version und Stand in Zitierbeispielen und README nach ([#43](https://github.com/pklaschka/feldspur/pull/43), @pklaschka)
- Handbuch-PDF als Broschüre druckbar, mit Rückumschlag ([#44](https://github.com/pklaschka/feldspur/pull/44), @pklaschka)
- Dependabot-Alerts beheben (esbuild, minimatch) ([#46](https://github.com/pklaschka/feldspur/pull/46), @pklaschka)
- Handbuch-PDF: Überschriften nie allein am Seitenende ([#50](https://github.com/pklaschka/feldspur/pull/50), @pklaschka)

### Neu dabei

- @pklaschka hat zum ersten Mal beigetragen: https://github.com/pklaschka/feldspur/pull/1

**Alle Änderungen**: https://github.com/pklaschka/feldspur/commits/v0.1.0
