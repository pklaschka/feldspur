# Feldspur

Feldspur legt alle Aufzeichnungen eines ethnografischen Feldeinsatzes (Tagebuchscans, Video, Audio, Fotos, Notizen) auf
**eine gemeinsame Uhrzeit-Achse** und macht daraus später ein codierbares Quelldokument, zuerst für MAXQDA.

Arbeitstitel, Stand: erste Implementierungsschritte (Einsammeln und Zeitbestimmung). Konzept und Tech-Stack sind im
Projekt außerhalb des Repositorys dokumentiert.

![Zeitachse mit dem erfundenen Testmarkt](docs/zeitachse.png)

## Aufbau

| Paket                              | Inhalt                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)   | Datenmodell (Zod), Zeitbestimmung, Uhrzeiten aus Dateinamen, Projektdatei (SQLite via better-sqlite3 + Drizzle)     |
| [`packages/media`](packages/media) | Einsammeln: Dateiart erkennen, ffprobe/EXIF lesen, SHA-256, Gerätevermutung, Zeitbelege, Import ins Projekt         |
| [`apps/desktop`](apps/desktop)     | Electron-App (React, Tailwind, Radix). Schritte Einsammeln, Abgleichen, Durchsehen (Canvas-Zeitachse), Detailleiste |
| [`scripts`](scripts)               | Entwicklerwerkzeuge                                                                                                 |

Werkzeugkette ist [Vite+](https://viteplus.dev) (`vp`): Vitest, Oxlint, Oxfmt, tsdown, Vite.

Oberfläche: Tailwind CSS v4 (Farben als CSS-Variablen in `styles.css`, hell/dunkel), Radix-Primitive (Reiter, Tooltips,
Regler), Zeitachse auf Canvas (`apps/desktop/src/renderer/timeline.ts`) mit einer verborgenen Liste für Tastatur und
Bildschirmleser.

Bewusste Abweichungen vom Tech-Stack-Dokument (mit Zuri abzustimmen):

- **exifr** statt ExifTool: liest Aufnahmezeiten aus JPEG/HEIC ohne Zusatzprogramm. ExifTool kommt dazu, falls RAW
  oder Videos ohne ffprobe-Zeit gebraucht werden.
- **Eigene Lautstärkekurve** statt FFmpeg-silencedetect: dieselbe Hüllkurve liefert Stille, laute Stellen und
  Klatscher für den Abgleich, ein Durchlauf statt zwei.

## Begriffe im Code

- **Einsatz** (`FieldSession`): ein Feldtag an einem Ort, wird zu einem MAXQDA-Dokument.
- **Gerät** (`Device`): hat eine Uhr. Genau eins pro Einsatz ist die **Referenzuhr**; für die anderen gibt es eine
  **Abweichung** (`clockOffsetMs`, Geräteuhr minus Referenz, positiv = geht vor).
- **Quelle** (`Source`): eine Originaldatei mit Prüfsumme. Kurzzeichen wie im Begleitprotokoll: `V-01`, `A-01`,
  `F-001`, `T-01`. Originale werden nie verändert.
- **Zeitbeleg** (`TimeEvidence`): eine Angabe, wann eine Stelle der Quelle war: Metadaten, Dateiname, angesagte Uhrzeit,
  Anker oder von Hand. Die Lage auf der Achse wird nie gespeichert, sondern immer aus den Belegen berechnet
  (`resolveTimeline`), damit nachvollziehbar bleibt, worauf sie sich stützt.
- **Sync-Anker** (`SyncAnchor`): „dieser Moment in A = dieser Moment in B“ (Klatschen, Tonspur-Vergleich, von Hand).
  Daraus ergibt sich die Abweichung eines Geräts, oder eine Quelle ohne eigene Zeit erbt ihre Lage.
- **Tonspur-Analyse**: Hüllkurve (100 Werte/s), Leerlauf (Stille ab 5 Min.) und laute Stellen darin (Wachhund) werden
  je Quelle in der Projektdatei zwischengespeichert. Daraus schlägt Feldspur Anker vor: per Kreuzkorrelation bei
  überlappenden Aufnahmen, sonst über Klatscher, bei denen alle Clips eines Geräts gemeinsam über die Uhrabweichung
  abstimmen. Vorschläge zählen erst nach Bestätigung.
- **Episode**: Zeitraum, in dem eine Aufnahme läuft und nicht Leerlauf ist (Lücken unter 5 Min. werden verbunden).
  Dazwischen liegen Zwischenzeiten mit Fotos und Tagebucheinträgen.
- **Tagebucheintrag** (`DiaryEntry`): Rahmen auf einer oder mehreren Scan-Seiten mit Notierzeit. Der
  **Bezugszeitraum** reicht vor die Notierzeit zurück (Standard 15 Min. pro Einsatz).

Alle Uhrzeiten sind Ortszeit des Einsatzes, intern als `LocalMs` (Wanduhrzeit in ms, gelesen als UTC). Unsicherheiten
werden als Wurzel der Quadratsumme kombiniert; „sicher“ heißt ± 2 s oder besser bei bekannter Geräteuhr.

## Entwickeln

Voraussetzungen: Node 22+, pnpm 10, FFmpeg (`ffmpeg`, `ffprobe`) im PATH.

```sh
pnpm install
pnpm check         # Format, Lint, Typen
pnpm test          # Vitest; Medien-Fixtures werden zur Laufzeit mit FFmpeg erzeugt
pnpm --filter @feldspur/desktop native   # better-sqlite3 für Electron holen (einmalig)
pnpm desktop       # App bauen und starten
pnpm e2e           # Rauchtest der App (Linux ohne Bildschirm: xvfb-run -a pnpm e2e)
```

Einen Ordner ohne App durchprobieren, z. B. das erfundene Testpaket:

```sh
pnpm probe /pfad/1_Rohquellen --reference ZOOM0004.m4a \
  --anchor ZOOM0004.m4a@80=C0012.MP4@20 --diary Tagebuch_S01.jpg@10:12
```

Abgleich mit dem Begleitprotokoll des Testpakets als Test:
`FELDSPUR_TESTPAKET=/pfad/1_Rohquellen pnpm test`.

**Keine echten Forschungsdaten** ins Repository oder in Tests. Fixtures werden erzeugt oder sind erfunden.

## Noch offen

- Exportformat (Zeitgerüst + Tagesvideo) wartet auf den MAXQDA-Test.
- Stellen beim Abspielen markieren (Anker und Ansagen zurzeit als m:ss eingeben).
- Episodengrenzen auf der Zeitachse verschieben, laute Stellen zur Mini-Episode machen, Wellenform in den Spuren.
- Tagebuch: Rahmen auf Scans ziehen, Kurzform/Volltext, Einträge über Seiten verketten.
- ExifTool statt exifr für RAW/HEIC, mitgelieferte FFmpeg-Programme, Paketierung mit electron-builder.
