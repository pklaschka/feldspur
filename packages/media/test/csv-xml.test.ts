/**
 * Kleine Helfer für Ausgabedateien: CSV für Excel (`packages/media/src/csv.ts`) und XML-Maskierung
 * (`packages/media/src/xml.ts`).
 */
import { describe, expect, it } from "vite-plus/test";
import { excelCsv } from "../src/csv.ts";
import { xmlEscape } from "../src/xml.ts";

describe("excelCsv", () => {
  it("schreibt BOM, Semikolon und CRLF", () => {
    expect(
      excelCsv([
        ["a", "b"],
        [1, null],
      ]),
    ).toBe("﻿a;b\r\n1;\r\n");
  });

  it("setzt Zellen mit Trennzeichen, Anführungszeichen oder Zeilenumbruch in Anführungszeichen", () => {
    expect(excelCsv([["x;y", 'sagt "hallo"', "zwei\nZeilen"]])).toBe('﻿"x;y";"sagt ""hallo""";"zwei\nZeilen"\r\n');
  });

  it.each`
    text                   | zelle
    ${"- lacht"}           | ${"'- lacht"}
    ${'=HYPERLINK("x")'}   | ${'"\'=HYPERLINK(""x"")"'}
    ${"+0:03"}             | ${"'+0:03"}
    ${"@Ali"}              | ${"'@Ali"}
    ${"\tTab"}             | ${"'\tTab"}
    ${"Marktstand - Ecke"} | ${"Marktstand - Ecke"}
  `("Text „$text“ bleibt in Excel Text: $zelle", ({ text, zelle }) => {
    expect(excelCsv([[text]])).toBe(`\uFEFF${zelle}\r\n`);
  });

  it("lässt negative Zahlen als Zahl stehen", () => {
    expect(excelCsv([[-5, 1.5]])).toBe("\uFEFF-5;1.5\r\n");
  });

  it("schreibt Objekte als JSON", () => {
    expect(excelCsv([[{ a: 1 }, true]])).toBe('﻿"{""a"":1}";true\r\n');
  });
});

describe("xmlEscape", () => {
  it("maskiert Sonderzeichen", () => {
    expect(xmlEscape(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;",
    );
  });

  it("entfernt in XML 1.0 unzulässige Steuerzeichen, behält Tab und Zeilenumbruch", () => {
    expect(xmlEscape("a\u0001b\u000bc\td\ne")).toBe("abc\td\ne");
  });
});
