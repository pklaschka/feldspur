// Seitenaufbau (Ränder, Kopf- und Fußzeile, Titelseite) steht in typst-template.typ.
// PDF im Design der App (apps/desktop/src/renderer/styles.css): Papier, Tinte, Terrakotta, Umbra.
// Schriften: Source Serif 4 für den Text, Source Sans 3 für Kopf, Fuß und Kästen (schriften/, SIL OFL).
// Farben und Schriftnamen stehen in typst-template.typ (vor diesem Kopf eingebunden).

#set text(fill: tinte, number-type: "lining")
#set par(leading: 0.68em)
#show link: set text(fill: terrakotta)
#show heading: set text(fill: umbra, weight: "semibold")
// Überschriften nie allein unten auf der Seite (Issue #48). `sticky` allein reicht in Typst 0.13 nicht,
// wenn darauf ein Block mit Label folgt (so setzt Quarto z. B. das Literaturverzeichnis). Deshalb
// reserviert jede Überschrift unsichtbar Platz für etwa zwei Zeilen darunter; passt der nicht mehr,
// rückt sie auf die nächste Seite. Der Abstand zum folgenden Text bleibt gleich.
#show heading: set block(sticky: true)
#show heading: it => {
  block(breakable: false, { it; v(2.5em) })
  v(-2.5em, weak: false)
}
#show heading.where(level: 1): it => {
  set text(fill: umbra)
  block(above: 1.6em, below: 0.9em, stroke: (bottom: 0.8pt + sand), inset: (bottom: 0.4em), width: 100%, it)
}
#show raw: set text(fill: tinte)
#show raw.where(block: true): it => block(fill: salbei, inset: 8pt, radius: 3pt, width: 100%, it)
#show outline.entry.where(level: 1): set text(fill: umbra, weight: "semibold")
#show figure.caption: set text(font: sans, size: 9pt, fill: tinte-2)
#show heading.where(level: 2): set block(above: 1.5em, below: 0.65em)
