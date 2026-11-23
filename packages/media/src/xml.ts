/**
 * Text für XML (FCPXML, .xlsx): Sonderzeichen maskieren und Steuerzeichen entfernen, die XML 1.0 nicht erlaubt.
 * Sonst lehnen Resolve oder Excel die ganze Datei ab, etwa wegen eines Tabulators aus einem Dateinamen.
 */
const ENTITY: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" };

export function xmlEscape(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex -- in XML 1.0 unzulässige Steuerzeichen entfernen
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/[<>&"']/g, (c) => ENTITY[c]!)
  );
}

/** Text für HTML und SVG (LIESMICH, Methodenteil, Feldkalender): `&`, `<`, `>` und `"` maskieren. */
export function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
