// PDF im Design der App (apps/desktop/src/renderer/styles.css): Papier, Tinte, Terrakotta, Umbra.
// Schriften: Source Serif 4 für den Text, Source Sans 3 für Kopf, Fuß und Kästen (schriften/, SIL OFL).
#let terrakotta = rgb("#a4441f")
#let umbra = rgb("#3a281d")
#let ocker = rgb("#c07a3a")
#let sand = rgb("#e3c9a8")
#let salbei = rgb("#e7ebe3")
#let linie = rgb("#d7dccf")
#let tinte = rgb("#26241f")
#let tinte-2 = rgb("#5b5d53")
#let sans = ("Source Sans 3",)
// Für die Hinweiskästen (kaesten.lua): Fläche und Randfarben wie die Hinweise in der App.
#let papier = rgb("#f4f5ef")
#let rost = rgb("#8f5a07")
#let moos = rgb("#44692f")

#set text(fill: tinte, number-type: "lining")
#set par(leading: 0.68em)
#show link: set text(fill: terrakotta)
#show heading: set text(fill: umbra, weight: "semibold")
#show heading.where(level: 1): it => {
  set text(fill: umbra)
  block(above: 1.6em, below: 0.9em, stroke: (bottom: 0.8pt + sand), inset: (bottom: 0.4em), width: 100%, it)
}
#show raw: set text(fill: tinte)
#show raw.where(block: true): it => block(fill: salbei, inset: 8pt, radius: 3pt, width: 100%, it)
#set page(
  // Ein schmaler Feldmarker am Rand statt eines Farbverlaufs: Umbra mit terrakottafarbener Fahne.
  background: place(left + top, dx: 0mm, dy: 0mm, stack(
    rect(width: 3mm, height: 22mm, fill: terrakotta),
    rect(width: 3mm, height: 100%, fill: umbra),
  )),
  footer: context {
    set text(font: sans, size: 8.5pt, fill: tinte-2)
    [Feldspur – Begleittext und Handbuch #h(1fr) #counter(page).display()]
  },
)
#show outline.entry.where(level: 1): set text(fill: umbra, weight: "semibold")
#show figure.caption: set text(font: sans, size: 9pt, fill: tinte-2)
#show heading.where(level: 2): set block(above: 1.5em, below: 0.65em)
