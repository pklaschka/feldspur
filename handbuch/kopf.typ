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
// Weniger Weißraum (Issue #176): Bildschirmfotos dürfen an den oberen oder unteren Rand der Seite (oder der
// nächsten) rücken, statt mit ihrer ganzen Höhe auf die nächste Seite zu springen und eine halbe Seite leer zu
// lassen. Der Text läuft dazwischen weiter; im Text stehen Verweise wie „Abbildung 3“.
#show figure.where(kind: "quarto-float-fig"): set figure(placement: auto)
// Tabellen mit Beschriftung dürfen wie Tabellen ohne über den Seitenrand umbrechen; der Kopf wiederholt sich.
#show figure.where(kind: "quarto-float-tbl"): set block(breakable: true)
#show heading.where(level: 2): set block(above: 1.5em, below: 0.65em)
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
