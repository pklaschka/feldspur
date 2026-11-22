import { digitsDurationMs, digitsDurationText } from "../src/shared/duration-digits.ts";
import { describe, expect, it } from "vite-plus/test";
import {
  aboutSize,
  bytes,
  dbText,
  dominantDay,
  errorText,
  formatDate,
  localDate,
  maskClock,
  maskClockAt,
  normalizeClock,
  offsetText,
  parseOffset,
  readOffsetInput,
  someLabels,
  stepClock,
} from "../src/renderer/format.ts";

describe("Uhrabweichung eingeben", () => {
  it.each`
    eingabe     | ergebnis     | fall
    ${""}       | ${null}      | ${"leer"}
    ${"  "}     | ${null}      | ${"nur Leerraum"}
    ${"+2;47"}  | ${"invalid"} | ${"Strichpunkt statt Doppelpunkt"}
    ${"abc"}    | ${"invalid"} | ${"Buchstaben"}
    ${"+2:47"}  | ${167_000}   | ${"plus"}
    ${"−0:30"}  | ${-30_000}   | ${"minus"}
    ${"± 0:00"} | ${0}         | ${"keine Abweichung"}
  `("„$eingabe“ ist $ergebnis ($fall)", ({ eingabe, ergebnis }) => {
    expect(readOffsetInput(eingabe)).toBe(ergebnis);
  });

  it.each`
    eingabe             | ms              | fall
    ${"−2:47"}          | ${-167_000}     | ${"Minuten und Sekunden"}
    ${"+0:04"}          | ${4_000}        | ${"nur Sekunden mit Doppelpunkt"}
    ${"-247"}           | ${-167_000}     | ${"Ziffern ohne Doppelpunkt"}
    ${"+4"}             | ${4_000}        | ${"eine Ziffer"}
    ${"+10247"}         | ${3_767_000}    | ${"Stunden ohne Doppelpunkt"}
    ${"-167"}           | ${null}         | ${"67 Sekunden gibt es nicht"}
    ${"1,5"}            | ${1_500}        | ${"Komma"}
    ${"+2:00:00"}       | ${7_200_000}    | ${"Stunden"}
    ${"+1 Tag 2:00:00"} | ${93_600_000}   | ${"Tag und Stunden"}
    ${"−3 Tage"}        | ${-259_200_000} | ${"Tage"}
    ${"+2 h 5 min"}     | ${7_500_000}    | ${"h und min"}
    ${"1d 0:00:30"}     | ${86_430_000}   | ${"d und Sekunden"}
    ${""}               | ${null}         | ${"leer ist Unsinn"}
    ${"abc"}            | ${null}         | ${"Buchstaben sind Unsinn"}
    ${"3 Wochen"}       | ${null}         | ${"Wochen kennt die App nicht"}
  `("„$eingabe“ ergibt $ms ms: $fall", ({ eingabe, ms }) => {
    expect(parseOffset(eingabe)).toBe(ms);
  });

  it.each([0, -167_000, 7_200_000, 93_600_000, -259_205_000])("Anzeige und Eingabe passen zusammen: %d ms", (ms) => {
    expect(parseOffset(offsetText(ms))).toBe(ms);
  });
});

describe("Uhrzeit als Maskenfeld", () => {
  it.each`
    getippt     | feld       | fall
    ${"1"}      | ${"1"}     | ${"eine Ziffer"}
    ${"10"}     | ${"10"}    | ${"Stunden"}
    ${"103"}    | ${"10:3"}  | ${"Doppelpunkt kommt von selbst"}
    ${"1030"}   | ${"10:30"} | ${"ganze Uhrzeit"}
    ${"10:30"}  | ${"10:30"} | ${"Doppelpunkt selbst getippt"}
    ${"10:305"} | ${"10:30"} | ${"mehr Ziffern als Platz"}
    ${"10:"}    | ${"10:"}   | ${"nach dem Doppelpunkt"}
    ${"10.3"}   | ${"10:3"}  | ${"Punkt wird Doppelpunkt"}
    ${"9"}      | ${"09"}    | ${"einstellige Stunde"}
    ${"93"}     | ${"09:3"}  | ${"einstellige Stunde, dann Minuten"}
    ${"9:"}     | ${"09:"}   | ${"einstellige Stunde mit Doppelpunkt"}
    ${"9:15"}   | ${"09:15"} | ${"einstellige Stunde, ganze Uhrzeit"}
  `("„$getippt“ zeigt „$feld“: $fall", ({ getippt, feld }) => {
    expect(maskClock(getippt)).toBe(feld);
  });

  it.each`
    feld        | marke | ergebnis                        | fall
    ${"1:00"}   | ${1}  | ${{ value: "1:00", caret: 1 }}  | ${"aus „15:00“ die 5 gelöscht"}
    ${"16:00"}  | ${2}  | ${{ value: "16:00", caret: 2 }} | ${"dann 6 getippt"}
    ${"165:00"} | ${2}  | ${{ value: "16:00", caret: 2 }} | ${"Ziffer in volle Stunde überschreibt die folgende"}
    ${"10:0"}   | ${3}  | ${{ value: "10:0", caret: 3 }}  | ${"aus „10:30“ die 3 gelöscht"}
    ${"10:40"}  | ${4}  | ${{ value: "10:40", caret: 4 }} | ${"dann 4 getippt"}
    ${"10:430"} | ${4}  | ${{ value: "10:40", caret: 4 }} | ${"4 hinter dem Doppelpunkt überschreibt die 3"}
    ${"1500"}   | ${2}  | ${{ value: "15:00", caret: 2 }} | ${"Doppelpunkt gelöscht: Ziffern fließen wie beim Tippen"}
    ${"103"}    | ${3}  | ${{ value: "10:3", caret: 4 }}  | ${"am Ende tippen wie bisher"}
  `("korrigiert mitten in der Uhrzeit: $fall", ({ feld, marke, ergebnis }) => {
    expect(maskClockAt(feld, marke)).toEqual(ergebnis);
  });

  it.each`
    feld       | ergebnis   | fall
    ${""}      | ${""}      | ${"leer bleibt leer"}
    ${"10"}    | ${"10:00"} | ${"volle Stunde"}
    ${"930"}   | ${"09:30"} | ${"einstellige Stunde"}
    ${"10:5"}  | ${"10:05"} | ${"einstellige Minute"}
    ${"10:30"} | ${"10:30"} | ${"vollständig"}
    ${"25:00"} | ${null}    | ${"Stunde zu groß"}
    ${"10:75"} | ${null}    | ${"Minute zu groß"}
    ${"ab"}    | ${null}    | ${"Buchstaben"}
  `("beim Verlassen wird „$feld“ zu $ergebnis: $fall", ({ feld, ergebnis }) => {
    expect(normalizeClock(feld)).toBe(ergebnis);
  });

  it("mit Sekunden: hh:mm:ss ohne Doppelpunkte", () => {
    const sec = { seconds: true };
    // Wenn: getippt wird, dann setzt die Maske beide Doppelpunkte
    expect(maskClock("103045", undefined, sec)).toBe("10:30:45");
    expect(maskClock("10304", undefined, sec)).toBe("10:30:4");
    expect(maskClock("1030", undefined, sec)).toBe("10:30");
    expect(maskClock("1030:", undefined, sec)).toBe("10:30:");
    expect(maskClock("93045", undefined, sec)).toBe("09:30:45");
    expect(maskClock("10:30:455", undefined, sec)).toBe("10:30:45");
    // Wenn: das Feld keine Sekunden hat, dann bleibt es bei hh:mm
    expect(maskClock("103045")).toBe("10:30");
    // Wenn: in den Sekunden von „10:30:45“ die 4 überschrieben wird, dann bleibt die Maske heil
    expect(maskClockAt("10:30:745", 7, sec)).toEqual({ value: "10:30:75", caret: 7 });
    expect(maskClockAt("10:30:45", 1, sec)).toEqual({ value: "10:30:45", caret: 1 });
    expect(maskClockAt("10304", 5, sec)).toEqual({ value: "10:30:4", caret: 7 });
    // Wenn: das Feld verlassen wird, dann wird ergänzt und geprüft
    expect(normalizeClock("103045", sec)).toBe("10:30:45");
    expect(normalizeClock("10:30:5", sec)).toBe("10:30:05");
    expect(normalizeClock("1030", sec)).toBe("10:30");
    expect(normalizeClock("10:30:75", sec)).toBeNull();
    expect(normalizeClock("10:30:45")).toBeNull();
    // Wenn: eine Pfeiltaste gedrückt wird, dann bleiben die Sekunden
    expect(stepClock("10:59:30", 1, sec)).toBe("11:00:30");
  });

  it.each`
    feld       | schritt | ergebnis   | fall
    ${"10:30"} | ${1}    | ${"10:31"} | ${"eine Minute vor"}
    ${"10:59"} | ${1}    | ${"11:00"} | ${"über die volle Stunde"}
    ${"00:00"} | ${-1}   | ${"23:59"} | ${"über Mitternacht zurück"}
    ${""}      | ${1}    | ${""}      | ${"leeres Feld bleibt leer"}
  `("Pfeiltaste verschiebt um Minuten: $fall", ({ feld, schritt, ergebnis }) => {
    expect(stepClock(feld, schritt)).toBe(ergebnis);
  });
});

describe("Zahlen als Text", () => {
  it.each`
    db     | text
    ${3.5} | ${"+3,5 dB"}
    ${-2}  | ${"−2,0 dB"}
    ${0}   | ${"±0,0 dB"}
  `("$db dB zeigt „$text“", ({ db, text }) => {
    expect(dbText(db)).toBe(text);
  });

  it.each`
    groesse             | text
    ${512}              | ${"512 B"}
    ${2048}             | ${"2 KB"}
    ${5.25 * 1024 ** 2} | ${"5,3 MB"}
    ${3 * 1024 ** 3}    | ${"3,00 GB"}
  `("$groesse Bytes zeigen „$text“", ({ groesse, text }) => {
    expect(bytes(groesse)).toBe(text);
  });
});

describe("Einsatzdatum und Dateien", () => {
  const at = (iso: string) => Date.parse(`${iso}Z`);
  const row = (iso: string | null, kind: string, extra: { chosen?: boolean; derived?: boolean } = {}) =>
    ({
      startMs: iso === null ? null : at(iso),
      evidence: [{ kind, chosen: extra.chosen ?? true, derived: extra.derived ?? false }],
      decision: null,
    }) as unknown as Parameters<typeof dominantDay>[0][number];

  it("nimmt den häufigsten Tag aus Metadaten und Dateinamen", () => {
    const r = dominantDay([
      row("2026-09-14T10:00:00", "metadata"),
      row("2026-09-14T23:59:00", "filename"),
      row("2026-09-15T00:01:00", "metadata"),
    ]);
    expect(r).toEqual({ day: "2026-09-14", count: 2, days: 2 });
  });

  it("zählt Handzeiten, Ansagen, Anker und unplatzierte Quellen nicht", () => {
    // Wenn: nur ein Foto mit Metadaten zählt, dann gewinnt sein Tag
    expect(
      dominantDay([
        row("2026-11-18T10:00:00", "manual"),
        row("2026-11-18T10:00:00", "spoken"),
        row("2026-11-18T10:00:00", "metadata", { derived: true }),
        row("2026-11-18T10:00:00", "metadata", { chosen: false }),
        row(null, "metadata"),
        row("2026-09-14T10:00:00", "metadata"),
      ]),
    ).toEqual({ day: "2026-09-14", count: 1, days: 1 });
    // Wenn: nichts zählt, dann gibt es keinen Tag
    expect(dominantDay([row("2026-11-18T10:00:00", "manual")])).toBeNull();
    expect(dominantDay([])).toBeNull();
  });

  it("gilt eine geprüfte Lage nach ihrer Grundlage", () => {
    const checked = { ...row("2026-09-14T10:00:00", "checked"), decision: { basisKind: "metadata" } };
    expect(dominantDay([checked as never])?.day).toBe("2026-09-14");
  });

  it("wählt bei Gleichstand den früheren Tag", () => {
    const r = dominantDay([row("2026-09-15T10:00:00", "metadata"), row("2026-09-14T10:00:00", "metadata")]);
    expect(r).toEqual({ day: "2026-09-14", count: 1, days: 2 });
  });

  it("zeigt Daten deutsch", () => {
    expect(formatDate("2026-09-14")).toBe("14.09.2026");
  });

  it("localDate nimmt die lokale Uhr, nicht UTC", () => {
    // Lokal kurz nach Mitternacht: UTC wäre je nach Zeitzone noch der Vortag.
    expect(localDate(new Date(2026, 10, 18, 0, 30))).toBe("2026-11-18");
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("Dauern ohne Doppelpunkt", () => {
  it.each`
    ziffern    | ms           | fall
    ${"45"}    | ${45_000}    | ${"Sekunden"}
    ${"320"}   | ${200_000}   | ${"Minuten und Sekunden"}
    ${"7500"}  | ${4_500_000} | ${"Minuten über 59"}
    ${"10320"} | ${3_800_000} | ${"Stunden"}
    ${"390"}   | ${null}      | ${"90 Sekunden gibt es nicht"}
    ${"3:20"}  | ${undefined} | ${"mit Doppelpunkt: nicht zuständig"}
  `("Ziffern „$ziffern“ füllen von rechts: $fall", ({ ziffern, ms }) => {
    expect(digitsDurationMs(ziffern)).toBe(ms);
  });

  it.each`
    ziffern    | text
    ${"320"}   | ${"3:20"}
    ${"0320"}  | ${"3:20"}
    ${"10320"} | ${"1:03:20"}
    ${"45"}    | ${"45"}
    ${"390"}   | ${"390"}
  `("Ziffern „$ziffern“ zeigen „$text“", ({ ziffern, text }) => {
    expect(digitsDurationText(ziffern)).toBe(text);
  });
});

describe("Fehlermeldungen aus dem Hauptprozess", () => {
  it("zeigt nur die Meldung, auch bei eigenen Fehlerklassen", () => {
    const remote = (m: string) => new Error(`Error invoking remote method 'export:run': ${m}`);
    expect(errorText(remote("Error: Es läuft schon eine Ausgabe."))).toBe("Es läuft schon eine Ausgabe.");
    expect(errorText(remote("ToolError: ffmpeg (1): kaputt.mp4: Invalid data"))).toBe(
      "ffmpeg (1): kaputt.mp4: Invalid data",
    );
    expect(errorText(new Error("Direkt"))).toBe("Direkt");
    expect(errorText("Text")).toBe("Text");
  });
});

describe("Geschätzte Größe des Montagevideos", () => {
  it.each`
    bytes              | text
    ${2.1 * 1024 ** 3} | ${"ca. 2,1 GB"}
    ${450 * 1024 ** 2} | ${"ca. 450 MB"}
    ${1000}            | ${"ca. 1 MB"}
  `("$bytes Bytes ergeben „$text“", ({ bytes, text }) => {
    expect(aboutSize(bytes)).toBe(text);
  });
});

describe("Lange Listen von Kurzzeichen", () => {
  const kurz = (n: number) => Array.from({ length: n }, (_, i) => `A-${String(i + 1).padStart(2, "0")}`);
  it.each`
    anzahl | text
    ${1}   | ${"A-01"}
    ${5}   | ${"A-01, A-02, A-03, A-04, A-05"}
    ${6}   | ${"A-01, A-02, A-03, A-04 und 2 weitere"}
    ${112} | ${"A-01, A-02, A-03, A-04 und 108 weitere"}
  `("$anzahl Kurzzeichen ergeben „$text“", ({ anzahl, text }) => {
    expect(someLabels(kurz(anzahl))).toBe(text);
  });
});
