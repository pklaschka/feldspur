import { describe, expect, it } from "vite-plus/test";
import { parseTranscript } from "../src/transcript-import.ts";

// Erfundene Beispiele in den Formaten, die Whisper und verwandte Werkzeuge schreiben.
describe("automatische Transkripte einlesen", () => {
  it("SRT mit Sprechern aus der Diarisierung", () => {
    const srt = `1
00:00:01,500 --> 00:00:04,000
[SPEAKER_00]: Guten Morgen, ist hier noch frei?

2
00:01:02,040 --> 00:01:05,000
[SPEAKER_01]: Ja, gleich neben dem Käsestand.
`;
    expect(parseTranscript(srt, "a.srt")).toEqual([
      { atMs: 1500, speaker: "S1", text: "Guten Morgen, ist hier noch frei?" },
      { atMs: 62_040, speaker: "S2", text: "Ja, gleich neben dem Käsestand." },
    ]);
  });

  it("WebVTT mit Stimmen-Tags und Stunden", () => {
    const vtt = `WEBVTT

00:00.250 --> 00:02.000
<v Interviewer>Wie lange stehen Sie schon hier?</v>

01:02:03.500 --> 01:02:05.000
Seit sieben.
`;
    expect(parseTranscript(vtt, "a.vtt")).toEqual([
      { atMs: 250, speaker: "Interviewer", text: "Wie lange stehen Sie schon hier?" },
      { atMs: 3_723_500, speaker: "", text: "Seit sieben." },
    ]);
  });

  it("Whisper-JSON und WhisperX mit Sprecherfeld", () => {
    const json = JSON.stringify({
      text: "…",
      segments: [
        { id: 0, start: 0.0, end: 2.1, text: " Erstes Segment." },
        { id: 1, start: 2.1, end: 4, text: " Zweites.", speaker: "SPEAKER_02" },
      ],
    });
    expect(parseTranscript(json, "a.json")).toEqual([
      { atMs: 0, speaker: "", text: "Erstes Segment." },
      { atMs: 2100, speaker: "S3", text: "Zweites." },
    ]);
  });

  it("Whisper-TSV in Millisekunden", () => {
    const tsv = "start\tend\ttext\n0\t1800\tHallo.\n1800\t4000\tNoch was.\n";
    expect(parseTranscript(tsv, "a.tsv").map((l) => l.atMs)).toEqual([0, 1800]);
  });

  it("meldet Unbekanntes und Leeres", () => {
    expect(() => parseTranscript("nur Text", "a.txt")).toThrow(/Format/);
    expect(() => parseTranscript("WEBVTT\n\n", "a.vtt")).toThrow(/keine Zeilen/);
  });
});
