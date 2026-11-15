// Farben aus dem App-Symbol (packaging/icon.svg) für das PDF. Nur ein erster Anstrich:
// Das eigentliche Design kommt mit dem Redesign.
#let terrakotta = rgb("#a8452c")
#let rost = rgb("#6e3218")
#let ocker = rgb("#d07a3e")
#let sand = rgb("#e6ab68")
#let moos = rgb("#7f8f5a")
#let papier = rgb("#fdf6e9")
#let tinte = rgb("#3a281d")

#set text(fill: tinte)
#show link: set text(fill: terrakotta)
#show heading: set text(fill: rost)
#show heading.where(level: 1): it => {
  set text(fill: terrakotta)
  block(below: 0.9em, stroke: (bottom: 1.5pt + sand), inset: (bottom: 0.35em), width: 100%, it)
}
#set page(
  background: place(left + top, rect(width: 6mm, height: 100%, fill: gradient.linear(terrakotta, ocker, sand, angle: 90deg))),
  footer: context {
    set text(size: 9pt, fill: rost)
    [Feldspur – Begleittext und Handbuch #h(1fr) #counter(page).display()]
  },
)
#show outline.entry.where(level: 1): set text(fill: rost, weight: "bold")
