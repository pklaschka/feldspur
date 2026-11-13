# Mitgelieferte Software Dritter

## FFmpeg (LGPL 2.1 oder später)

Feldspur liefert die Programme `ffmpeg` und `ffprobe` aus dem FFmpeg-Projekt (https://ffmpeg.org) mit.
Sie liegen als eigenständige Programme im Ordner `bin` der App-Ressourcen. Feldspur ruft sie als
eigene Prozesse auf und linkt nicht gegen sie.

- Lizenz: GNU Lesser General Public License 2.1 oder später, siehe `FFmpeg-LICENSE.txt`.
- Es ist eine LGPL-Fassung: gebaut ohne `--enable-gpl` und ohne `--enable-nonfree`.
- Herkunft, Prüfsumme und die genaue Konfiguration stehen in `FFmpeg-BUILD.txt`.
- Quellcode: die in `FFmpeg-BUILD.txt` genannte Version unter https://ffmpeg.org/releases/ bzw.
  https://github.com/BtbN/FFmpeg-Builds (Windows, Linux). Auf Anfrage stellen wir ihn auch selbst bereit.
- Austauschen: Die beiden Programme dürfen durch einen eigenen Build ersetzt werden. Alternativ
  lassen sich andere Programme über die Umgebungsvariablen `FELDSPUR_FFMPEG` und `FELDSPUR_FFPROBE` wählen.

FFmpeg ist eine Marke von Fabrice Bellard, Begründer des FFmpeg-Projekts.

## Weitere Bestandteile

| Paket              | Lizenz                                                |
| ------------------ | ----------------------------------------------------- |
| Electron, Chromium | MIT bzw. siehe `LICENSES.chromium.html` im App-Ordner |
| better-sqlite3     | MIT                                                   |
| SQLite             | gemeinfrei                                            |
| React, React DOM   | MIT                                                   |
| Radix UI           | MIT                                                   |
| Drizzle ORM        | Apache-2.0                                            |
| Zod                | MIT                                                   |
| exifr              | MIT                                                   |
| Tailwind CSS       | MIT                                                   |
