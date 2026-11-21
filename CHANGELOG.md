# Changelog

Änderungen an der Feldspur-App. Die Einträge entstehen beim Release automatisch aus den Titeln der
zusammengeführten Pull Requests (siehe `.github/release.yml` für die Rubriken). Vorabversionen (`-rc.N` usw.)
werden beim zugehörigen Release zu einem Abschnitt zusammengefasst.

## 0.3.0-rc.2 – 2026-11-21 (Vorabversion)

<!-- Release notes generated using configuration in .github/release.yml at 2e7c382123c7a0e8b2e8ec98a208df891f8b18d9 -->

### Behoben

- Nach und nach eingesammelte Clips, kurze Pixel-Videos und Uhrzeiten nach Mitternacht liegen richtig ([#155](https://github.com/pklaschka/feldspur/pull/155), @pklaschka)

### Dokumentation

- Handbuch nennt Knöpfe und Menüs so, wie sie in der App heißen ([#156](https://github.com/pklaschka/feldspur/pull/156), @pklaschka)

### Hinter den Kulissen

- Workflow-Artefakte kürzer aufbewahren ([#158](https://github.com/pklaschka/feldspur/pull/158), @pklaschka)

**Alle Änderungen**: https://github.com/pklaschka/feldspur/compare/v0.3.0-rc.1...v0.3.0-rc.2

## 0.3.0-rc.1 – 2026-11-20 (Vorabversion)

<!-- Release notes generated using configuration in .github/release.yml at a9dce054f2f223e42a43e94555e62e5e4ad5bc5d -->

### Neu

- Hinweis, wenn das Einsatzdatum nicht zu den Dateien passt ([#84](https://github.com/pklaschka/feldspur/pull/84), @pklaschka)
- Laufende Ausgabe abbrechen ([#88](https://github.com/pklaschka/feldspur/pull/88), @pklaschka)
- Fotos lassen sich als Tagebuchseite behandeln (und zurück) ([#98](https://github.com/pklaschka/feldspur/pull/98), @pklaschka)
- Einsätze lassen sich löschen ([#100](https://github.com/pklaschka/feldspur/pull/100), @pklaschka)
- Kontext: Karten, Listen und Zusammenfassungen ohne Uhrzeit stehen vor der Chronologie ([#115](https://github.com/pklaschka/feldspur/pull/115), @pklaschka)
- Montagevideo: zusätzlich eine Tonspur je Gerät ([#126](https://github.com/pklaschka/feldspur/pull/126), @pklaschka)
- Viewer: Einsatztranskript synchron zum Montagevideo im Browser ([#127](https://github.com/pklaschka/feldspur/pull/127), @pklaschka)

### Verbessert

- Suche zeigt, wenn es mehr Treffer gibt, und liest den gewählten Treffer vor ([#85](https://github.com/pklaschka/feldspur/pull/85), @pklaschka)
- Erneut ausgeben merkt sich den Ordner und meldet gesperrte Dateien verständlich ([#89](https://github.com/pklaschka/feldspur/pull/89), @pklaschka)
- Tagebuch: Neuer Eintrag übernimmt die Form des vorigen ([#94](https://github.com/pklaschka/feldspur/pull/94), @pklaschka)
- Durchsehen: Nach „Lage passt“ geht es gleich zur nächsten Stelle, mit Tastenkürzeln ([#95](https://github.com/pklaschka/feldspur/pull/95), @pklaschka)
- Neues Projekt: ersten Einsatz direkt auf der Startfläche anlegen ([#97](https://github.com/pklaschka/feldspur/pull/97), @pklaschka)
- Hinweis, wenn Dateien neben „Einsammeln“ abgelegt werden ([#101](https://github.com/pklaschka/feldspur/pull/101), @pklaschka)
- Tagebucheinträge nachträglich verschieben und in der Größe ändern ([#106](https://github.com/pklaschka/feldspur/pull/106), @pklaschka)
- Alle Uhrzeit- und Stellenfelder ohne Doppelpunkt tippen ([#107](https://github.com/pklaschka/feldspur/pull/107), @pklaschka)
- Das Zeitgerüst heißt jetzt Einsatztranskript ([#112](https://github.com/pklaschka/feldspur/pull/112), @pklaschka)
- Tonspur-Analyse lässt sich abbrechen; Abbrechen wirkt auch bei Lautstärkemessung und Standbildern ([#139](https://github.com/pklaschka/feldspur/pull/139), @pklaschka)

### Behoben

- Transkript-Import lässt sich rückgängig machen und meldet ausgelassene Zeilen ([#83](https://github.com/pklaschka/feldspur/pull/83), @pklaschka)
- Fehlermeldungen erscheinen auch in geöffneten Dialogen ([#86](https://github.com/pklaschka/feldspur/pull/86), @pklaschka)
- Ungültige Uhrzeiten abweisen und Statuspunkte für Screenreader beschriften ([#87](https://github.com/pklaschka/feldspur/pull/87), @pklaschka)
- Mitschreiben: Weitertippen und angefangene Zeilen gehen nicht mehr verloren ([#90](https://github.com/pklaschka/feldspur/pull/90), @pklaschka)
- „Alle eindeutigen übernehmen“ klappt ohne Fehlermeldung und lässt sich in einem Schritt rückgängig machen ([#91](https://github.com/pklaschka/feldspur/pull/91), @pklaschka)
- Tippfehler bei der Uhrabweichung löscht den Abgleich nicht mehr ([#92](https://github.com/pklaschka/feldspur/pull/92), @pklaschka)
- Tagebuch: Getippter Text bleibt beim Blättern und Schließen erhalten ([#93](https://github.com/pklaschka/feldspur/pull/93), @pklaschka)
- Zeilenumbrüche im Tagebuch-Volltext bleiben im Zeitgerüst erhalten ([#96](https://github.com/pklaschka/feldspur/pull/96), @pklaschka)
- Ausgabe unter macOS: Montagevideo scheitert nicht mehr an fehlendem PNG-Decoder ([#114](https://github.com/pklaschka/feldspur/pull/114), @pklaschka)
- Montagevideo synchron: Feinabgleich schlägt angesagte Uhrzeit ([#120](https://github.com/pklaschka/feldspur/pull/120), @pklaschka)
- Ausgabe: Prüfsummen erst nach der Ordnerwahl prüfen ([#119](https://github.com/pklaschka/feldspur/pull/119), @pklaschka)
- Montagevideo: Bei einem Fehler wird sofort abgebrochen statt weitergerechnet ([#140](https://github.com/pklaschka/feldspur/pull/140), @pklaschka)
- Ausgabe hängt nicht mehr, wenn die Oberfläche währenddessen neu lädt ([#141](https://github.com/pklaschka/feldspur/pull/141), @pklaschka)
- Während der Ausgabe geht der Rechner nicht mehr in den Ruhezustand ([#143](https://github.com/pklaschka/feldspur/pull/143), @pklaschka)
- Video-Zeiten genauer: Android-Videos überlappen nicht mehr, Kamera-Timecode, Zeitbelege neu lesen ([#146](https://github.com/pklaschka/feldspur/pull/146), @pklaschka)
- Markierter Text bleibt sichtbar, auch in der laufenden Mitschreib-Zeile ([#148](https://github.com/pklaschka/feldspur/pull/148), @pklaschka)

### Dokumentation

- Tastenkürzel-Spickblatt zum Ausdrucken ([#82](https://github.com/pklaschka/feldspur/pull/82), @pklaschka)
- Tastenkürzel-Spickblatt um die Kürzel in „Durchsehen“ ergänzt ([#99](https://github.com/pklaschka/feldspur/pull/99), @pklaschka)
- Lieferling als empfohlenen Installationsweg nennen ([#111](https://github.com/pklaschka/feldspur/pull/111), @pklaschka)

### Hinter den Kulissen

- Release-Workflow: Hotfix-Branches, Changelog 0.2.1 ([#124](https://github.com/pklaschka/feldspur/pull/124), @pklaschka)
- CI: Actions auf Node-24-Versionen heben ([#125](https://github.com/pklaschka/feldspur/pull/125), @pklaschka)
- Ein gemeinsamer Weg für ffmpeg und ffprobe (Zeitlimits, einheitliche Fehlermeldungen) ([#138](https://github.com/pklaschka/feldspur/pull/138), @pklaschka)

**Alle Änderungen**: https://github.com/pklaschka/feldspur/compare/v0.2.1...v0.3.0-rc.1

## 0.2.1 – 2026-11-19

Hotfix auf Grundlage von 0.2.0. Die Neuerungen, die seitdem in `main` liegen, kommen mit 0.3.0.

### Behoben

- Montagevideo synchron: Feinabgleich schlägt angesagte Uhrzeit ([#120](https://github.com/pklaschka/feldspur/pull/120), @pklaschka)
- Ausgabe unter macOS: Montagevideo scheitert nicht mehr an fehlendem PNG-Decoder ([#114](https://github.com/pklaschka/feldspur/pull/114), @pklaschka)

**Alle Änderungen**: https://github.com/pklaschka/feldspur/compare/v0.2.0...v0.2.1

## 0.2.0 – 2026-11-18

<!-- Release notes generated using configuration in .github/release.yml at 199a118a1475fd5b6fec304ab47d2d5e1f6076a2 -->

### Neu

- Projektdateien automatisch sichern und als Kopie wiederherstellen ([#78](https://github.com/pklaschka/feldspur/pull/78), @pklaschka)
- Widersprüche zwischen Zeitbelegen sehen und bewusst entscheiden ([#79](https://github.com/pklaschka/feldspur/pull/79), @pklaschka)

### Verbessert

- Fehlende oder veränderte Originaldateien erkennen und neu verknüpfen ([#77](https://github.com/pklaschka/feldspur/pull/77), @pklaschka)
- Widersprüche: Oberfläche näher an die Skizze ([#80](https://github.com/pklaschka/feldspur/pull/80), @pklaschka)
- Ausgabestand übersteht Neustarts, große Ordner mit Fortschritt und Abbrechen einsammeln ([#81](https://github.com/pklaschka/feldspur/pull/81), @pklaschka)

### Hinter den Kulissen

- Aufräumen: ungenutzter Code und doppelte Logik ([#60](https://github.com/pklaschka/feldspur/pull/60), @pklaschka)
- Hook-Regeln einschalten und alle Meldungen beheben ([#61](https://github.com/pklaschka/feldspur/pull/61), @pklaschka)
- Große Komponenten aufteilen, Logik mit Tests absichern ([#62](https://github.com/pklaschka/feldspur/pull/62), @pklaschka)
- Modern Web Guidance einbinden und Altlasten im Code aufräumen ([#76](https://github.com/pklaschka/feldspur/pull/76), @pklaschka)

### Weitere Änderungen

- Inspektor springt nicht mehr beim Laden eines Videos ([#66](https://github.com/pklaschka/feldspur/pull/66), @pklaschka)
- Zeitgerüst-Vorschau in den Farben des .docx ([#67](https://github.com/pklaschka/feldspur/pull/67), @pklaschka)

**Alle Änderungen**: https://github.com/pklaschka/feldspur/compare/v0.1.2...v0.2.0

## 0.1.2 – 2026-11-17

<!-- Release notes generated using configuration in .github/release.yml at f5d3adf9bccaff8437a9a335d51395911779119e -->

### Behoben

- Handbuch-PDF: Glossarbegriffe nie allein, Abstand über „Literatur“ ([#59](https://github.com/pklaschka/feldspur/pull/59), @pklaschka)

**Alle Änderungen**: https://github.com/pklaschka/feldspur/compare/v0.1.1...v0.1.2

## 0.1.1 – 2026-11-17

<!-- Release notes generated using configuration in .github/release.yml at f6cf8cec147890bb6b2c9039987be8804c0bd856 -->

### Dokumentation

- Zenodo-DOI in Zitierangaben, Handbuch und README ([#52](https://github.com/pklaschka/feldspur/pull/52), @pklaschka)
- Handbuch: Druckfassung mit 3 mm Beschnitt (216 × 303 mm) ([#57](https://github.com/pklaschka/feldspur/pull/57), @pklaschka)

### Weitere Änderungen

- Handbuch: lange Links auf dem Handy umbrechen ([#51](https://github.com/pklaschka/feldspur/pull/51), @pklaschka)
- DOI im Handbuch als Software-DOI ausweisen ([#53](https://github.com/pklaschka/feldspur/pull/53), @pklaschka)
- Handbuch-Webseite: README-Vorlage nicht mehr als Notebook verlinken ([#55](https://github.com/pklaschka/feldspur/pull/55), @pklaschka)
- Handbuch: Montagevideo nicht mehr „nur zum Zuordnen“ ([#58](https://github.com/pklaschka/feldspur/pull/58), @pklaschka)

**Alle Änderungen**: https://github.com/pklaschka/feldspur/compare/v0.1.0...v0.1.1

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
