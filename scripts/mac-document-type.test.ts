import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { macDocumentTypes, PROJECT_EXTENSION, PROJECT_ICON_FILE, PROJECT_UTI } from "./mac-document-type.mjs";

const root = join(import.meta.dirname, "..");
const plist = macDocumentTypes();
const type = plist.UTExportedTypeDeclarations[0]!;
const document = plist.CFBundleDocumentTypes[0]!;

describe("Projektdateien unter macOS", () => {
  it("Feldspur meldet einen eigenen Dateityp für die Endung .feldspur an", () => {
    expect(type.UTTypeIdentifier).toBe(PROJECT_UTI);
    expect(type.UTTypeTagSpecification["public.filename-extension"]).toEqual([PROJECT_EXTENSION]);
  });

  it("der Dokumenttyp verweist auf diesen Dateityp, nicht nur auf die Endung", () => {
    expect(document.LSItemContentTypes).toEqual([PROJECT_UTI]);
    expect(document).not.toHaveProperty("CFBundleTypeExtensions");
  });

  it("Feldspur öffnet die eigenen Projektdateien als erste Wahl", () => {
    expect(document.LSHandlerRank).toBe("Owner");
  });

  it("Dateityp und Dokumenttyp tragen dasselbe Symbol, und es liegt im Paketordner", () => {
    expect(type.UTTypeIconFile).toBe(PROJECT_ICON_FILE);
    expect(document.CFBundleTypeIconFile).toBe(PROJECT_ICON_FILE);
    expect(existsSync(join(root, "packaging", PROJECT_ICON_FILE))).toBe(true);
  });

  it.each`
    groesse | kennung
    ${16}   | ${"icp4"}
    ${32}   | ${"icp5"}
    ${128}  | ${"ic07"}
    ${256}  | ${"ic08"}
    ${512}  | ${"ic09"}
    ${1024} | ${"ic10"}
  `("das Symbol bringt $groesse px mit ($kennung), auch für Listen und Spalten im Finder", ({ kennung }) => {
    expect(icnsTypes(readFileSync(join(root, "packaging", PROJECT_ICON_FILE)))).toContain(kennung);
  });
});

/** Kennungen der Bilder in einer .icns-Datei (Kopf „icns“, dann Blöcke aus Kennung, Länge, Inhalt). */
function icnsTypes(data: Buffer): string[] {
  const types: string[] = [];
  for (let at = 8; at < data.length; at += data.readUInt32BE(at + 4)) types.push(data.toString("latin1", at, at + 4));
  return types;
}
