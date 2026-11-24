// Projektdateien unter macOS: Dokumenttyp und eigenes Dateisymbol.
//
// Seit macOS 11 reicht `CFBundleTypeExtensions` (das erzeugt electron-builder aus `fileAssociations`) nicht mehr
// zuverlässig: Finder ordnet die Endung dann nur einem namenlosen Ersatztyp zu und zeigt ein leeres Blatt statt
// unseres Symbols. Deshalb meldet Feldspur einen eigenen Typ an (UTI, `UTExportedTypeDeclarations`), der die
// Endung `.feldspur` und das Symbol trägt, und der Dokumenttyp verweist über `LSItemContentTypes` darauf.
//
// Genutzt beim Paketieren (`scripts/package-desktop.mjs`, Issue #165); die App selbst braucht diese Datei nicht.

export const PROJECT_UTI = "app.feldspur.projekt";
export const PROJECT_EXTENSION = "feldspur";
export const PROJECT_ICON_FILE = "datei-icon.icns";

/** Einträge für die Info.plist der App, gedacht für `mac.extendInfo` von electron-builder. */
export function macDocumentTypes() {
  return {
    UTExportedTypeDeclarations: [
      {
        UTTypeIdentifier: PROJECT_UTI,
        UTTypeDescription: "Feldspur-Projekt",
        // Eine Projektdatei ist eine einzelne SQLite-Datei, kein Paketordner.
        UTTypeConformsTo: ["public.data", "public.database"],
        UTTypeIconFile: PROJECT_ICON_FILE,
        UTTypeTagSpecification: { "public.filename-extension": [PROJECT_EXTENSION] },
      },
    ],
    CFBundleDocumentTypes: [
      {
        CFBundleTypeName: "Feldspur-Projekt",
        CFBundleTypeRole: "Editor",
        CFBundleTypeIconFile: PROJECT_ICON_FILE,
        LSItemContentTypes: [PROJECT_UTI],
        // Feldspur hat den Typ erfunden, also ist es die erste Wahl beim Doppelklick.
        LSHandlerRank: "Owner",
      },
    ],
  };
}
