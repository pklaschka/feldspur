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
#show heading.where(level: 2).or(heading.where(level: 3)): it => {
  block(breakable: false, { it; v(2.5em) })
  v(-2.5em, weak: false)
}
#show heading.where(level: 1): it => {
  set text(fill: umbra)
  block(above: 1.6em, below: 0.9em, stroke: (bottom: 0.8pt + sand), inset: (bottom: 0.4em), width: 100%, it)
}
// Jedes Kapitel (oberste Ebene) beginnt auf einer neuen Seite (Issue #174). Ausnahme: die Motivation folgt direkt
// auf den einleitenden Text. `weak` entfällt, wo die Seite ohnehin neu beginnt (etwa nach dem Umbruch vor dem
// Handbuch-Teil). Das Inhaltsverzeichnis (nicht im Verzeichnis selbst geführt) bleibt, wo es ist.
// Steht nach den anderen Regeln für Überschriften, damit Typst sie zuerst anwendet und der Umbruch außerhalb
// ihrer Blöcke landet.
#show heading.where(level: 1): it => {
  if it.outlined and it.at("label", default: none) != <sec-motivation> { pagebreak(weak: true) }
  it
}
#show raw: set text(fill: tinte)
#show raw.where(block: true): it => block(fill: salbei, inset: 8pt, radius: 3pt, width: 100%, it)
#show outline.entry.where(level: 1): set text(fill: umbra, weight: "semibold")
#show figure.caption: set text(font: sans, size: 9pt, fill: tinte-2)
// Weniger Weißraum (Issue #176): Bildschirmfotos bleiben im Textfluss, also in ihrem Abschnitt und an ihrer
// Stelle, aber etwas schmaler als der Satzspiegel. So passen sie öfter noch auf die angefangene Seite, statt mit
// ihrer ganzen Höhe auf die nächste zu springen und unten eine halbe Seite leer zu lassen.
#show figure.where(kind: "quarto-float-fig"): set image(width: 85%)
// Tabellen (Issue #176): Spaltenbreiten nach Inhalt (tabellen.lua), etwas kleinerer Text, kein Blocksatz (reißt in
// schmalen Spalten Lücken), Kopf in der Auszeichnungsschrift, feine Linien zwischen den Zeilen statt Leerraum.
#show table: set par(justify: false, leading: 0.55em)
#show table: set text(size: 0.9em)
#set table(
  inset: (x: 5pt, y: 5pt),
  align: left + top,
  stroke: (_, y) => if y > 0 { (bottom: 0.4pt + linie) },
)
#set table.hline(stroke: 0.8pt + umbra)
#show table.cell.where(y: 0): set text(font: sans, weight: "semibold", fill: umbra)
// Tabelle und Beschriftung linksbündig wie der Text; schmale Tabellen stehen sonst mittig mit leerem Rand. Tabellen
// dürfen über den Seitenrand umbrechen; der Kopf wiederholt sich.
#show figure.where(kind: "quarto-float-tbl"): it => block(width: 100%, breakable: true, {
  set align(left)
  // Beschriftung nie allein unten auf der Seite: Sie rückt mit der Tabelle auf die nächste.
  block(sticky: true, below: 0.4em, it.caption)
  it.body
})
// Tastenkürzel als Tastenkappen (tasten.lua): `tasten("Strg", "+", "O")`, „+“ und „/“ stehen zwischen den Tasten.
// Bleiben als Ganzes in einer Zeile.
#let symbol-taste(pfad) = box(image(
  bytes(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='2.5 2.5 19 19'><path d='" + pfad
      + "' fill='none' stroke='" + tinte.to-hex() + "' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'/></svg>",
  ),
  height: 0.66em,
))
#let taste(name) = box(
  fill: papier,
  stroke: (paint: tinte-2.transparentize(55%), thickness: 0.5pt),
  radius: 2pt,
  inset: (x: 0.28em),
  outset: (y: 0.2em),
  {
    // ⌘ und ⇧ fehlen in Source Sans. Eine Ersatzschrift setzt sie je nach Rechner anders groß und verrutscht, deshalb
    // sind sie hier gezeichnet: so hoch wie ein Großbuchstabe, auf der Grundlinie.
    show "⌘": symbol-taste(
      "M9 6v12M15 6v12M6 9h12M6 15h12M9 9H6a3 3 0 1 1 3-3M15 9V6a3 3 0 1 1 3 3M15 15h3a3 3 0 1 1-3 3M9 15v3a3 3 0 1 1-3-3",
    )
    show "⇧": symbol-taste("M12 3.5 4 12h4.5v8h7v-8H20Z")
    text(font: sans, size: 0.82em, weight: "medium", fill: tinte, name)
  },
)
#let tasten(..teile) = box(
  teile
    .pos()
    .enumerate()
    .map(((i, t)) => if calc.odd(i) { h(0.1em) + text(font: sans, size: 0.82em, fill: tinte-2, t) + h(0.1em) } else { taste(t) })
    .join(),
)
#show heading.where(level: 2): set block(above: 1.5em, below: 0.65em)
// Literaturverzeichnis wie in Fachtexten üblich: hängender Einzug, damit die Autor*innen links eine Spalte bilden
// und sich überfliegen lassen; Flattersatz statt Blocksatz (der riss um lange Adressen Lücken); etwas kleiner und
// enger als der Fließtext; Adressen in Tinte statt Terrakotta, damit nicht jede Zeile rot leuchtet. Klickbar bleiben sie.
#show <refs>: set par(justify: false, hanging-indent: 1.5em, leading: 0.6em)
#show <refs>: set text(size: 0.92em)
#show <refs>: set block(spacing: 0.85em)
#show <refs>: it => {
  show link: set text(fill: tinte-2)
  it
}
// Begriff und Erklärung im Glossar nie getrennt: Begriff nie allein unten auf der Seite. Gleiche Darstellung
// wie Quartos Vorgabe (definitions.typ), aber jeder Eintrag als ein Block, der nicht umbrochen wird.
#show terms: it => {
  it.children
    .map(child => block(breakable: false, width: 100%)[
      #strong[#child.term]
      #block(inset: (left: 1.5em, top: -0.4em))[#child.description]
    ])
    .join()
}
