// Seitenaufbau des PDF-Handbuchs (ersetzt Quartos article-Vorlage, siehe template-partials in _quarto.yml).
// Für beidseitigen Druck: innen breiterer Rand, Seitenzahl und Randmarke außen, Kopfzeile mit dem Kapitel
// auf rechten Seiten. Vorne: Titelseite, Rückseite mit Angaben (Zitieren, Lizenz, Interessenkonflikte),
// Inhaltsverzeichnis auf eigener Seite. Farben und Schriften kommen aus kopf.typ.
// Farben aus der App, auch für kopf.typ und kaesten.lua.
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


#let article(
  title: none,
  subtitle: none,
  authors: none,
  date: none,
  abstract: none,
  abstract-title: none,
  keywords: none,
  doi: none,
  url: none,
  license: none,
  cols: 1,
  lang: "en",
  region: "US",
  font: "libertinus serif",
  fontsize: 11pt,
  title-size: 1.5em,
  subtitle-size: 1.25em,
  heading-family: "libertinus serif",
  heading-weight: "bold",
  heading-style: "normal",
  heading-color: black,
  heading-line-height: 0.65em,
  sectionnumbering: none,
  toc: false,
  toc_title: none,
  toc_depth: none,
  toc_indent: 1.5em,
  doc,
) = {
  set par(justify: true)
  set text(lang: lang, region: region, font: font, size: fontsize, hyphenate: true)
  set heading(numbering: sectionnumbering)
  // Pandoc maskiert „/“ in Zeichenketten als „\/“.
  if url != none { url = url.replace("\\/", "/") }

  // Ab hier zählt der Inhalt: Kopf- und Fußzeile erst danach, auf Vorsatzseiten nichts.
  let body-start = state("fs-body-start", none)

  set page(
    margin: (inside: 27mm, outside: 21mm, top: 26mm, bottom: 24mm),
    binding: left,
    // Randmarke außen: oben ein Stück Terrakotta (die Fahne), darunter Umbra (der Stab).
    background: context {
      // Auch Leerseiten tragen die Randmarke, damit der gedruckte Block durchgehend gleich aussieht.
      let side = if calc.odd(here().page()) { right } else { left }
      place(side + top, stack(
        rect(width: 3mm, height: 22mm, fill: terrakotta),
        rect(width: 3mm, height: 100%, fill: umbra),
      ))
    },
    header: context {
      let start = body-start.get()
      if start == none or here().page() <= start { return }
      let p = here().page()
      // Beginnt oben auf der Seite ein Kapitel, steht sein Titel schon groß da: keine Kopfzeile.
      if query(heading.where(level: 1)).any(k => k.location().page() == p and k.location().position().y < 45mm) { return }
      set text(font: sans, size: 8.5pt, fill: tinte-2)
      if calc.odd(p) {
        // Rechte Seite: das laufende Kapitel, außen.
        let before = query(heading.where(level: 1).before(here()))
        let chapter = if before.len() > 0 {
          let k = before.last()
          if k.numbering != none {
            numbering(k.numbering, ..counter(heading).at(k.location()))
            h(0.5em)
            k.body
          } else { k.body }
        } else { [] }
        align(right, chapter)
      } else {
        align(left)[Feldspur · Begleittext und Handbuch]
      }
      v(-0.55em)
      line(length: 100%, stroke: 0.4pt + linie)
    },
    footer: context {
      let start = body-start.get()
      if start == none or here().page() < start { return }
      set text(font: sans, size: 9pt, fill: tinte-2)
      let n = counter(page).display()
      if calc.odd(here().page()) { align(right, n) } else { align(left, n) }
    },
  )

  // Titelseite
  {
    set par(justify: false)
    v(14mm)
    image("bilder/logo.svg", width: 20mm)
    v(4mm)
    text(font: sans, size: 10pt, fill: tinte-2, tracking: 0.02em)[Begleittext und Handbuch]
    v(4mm)
    text(font: heading-family, weight: "semibold", size: 34pt, fill: heading-color)[#title]
    set text(hyphenate: false)
    if subtitle != none {
      v(3mm)
      block(width: 88%, { set par(leading: 0.5em); text(font: heading-family, style: "italic", size: 15pt, fill: umbra)[#subtitle] })
    }
    v(12mm)
    if authors != none {
      for a in authors {
        block(below: 1.2mm, text(size: 12pt, weight: "semibold")[#a.name])
        if a.at("orcid", default: "") != "" {
          text(font: sans, size: 9.5pt, fill: tinte-2)[ORCID #link("https://orcid.org/" + a.orcid)[#a.orcid]]
        }
        v(3mm)
      }
    }
    if date != none { text(font: sans, size: 9.5pt, fill: tinte-2)[Stand: #date] }
    if doi != none {
      linebreak()
      text(font: sans, size: 9.5pt, fill: tinte-2)[DOI #link("https://doi.org/" + doi)[#doi]]
    }
    v(14mm)
    if abstract != none {
      block(width: 100%, inset: (left: 5mm), stroke: (left: 1pt + sand))[
        #text(font: sans, weight: "semibold", size: 9.5pt, fill: umbra)[#abstract-title]
        #v(1mm)
        #set par(justify: true)
        #abstract
      ]
    }
    if keywords != none {
      v(4mm)
      text(font: sans, size: 9pt, fill: tinte-2)[*Schlüsselwörter:* #keywords.join(", ")]
    }
  }

  // Rückseite der Titelseite: Angaben, wie sie in Zeitschriften vorn oder hinten stehen.
  pagebreak(to: "even")
  {
    set par(justify: false)
    set text(size: 9pt)
    v(1fr)
    let item(label, body) = block(below: 4mm)[
      #text(font: sans, weight: "semibold", fill: umbra)[#label] \
      #body
    ]
    if authors != none {
      item("Autor*in", for a in authors [
        #a.name#if a.at("orcid", default: "") != "" [, ORCID #link("https://orcid.org/" + a.orcid)[#a.orcid]] \
      ])
    }
    item("Zitieren", [
      Klaschka, Z. N. (2026). _Feldspur: Multimediale Feldaufzeichnungen auf einer gemeinsamen Zeitachse
      zusammenführen. Begleittext und Handbuch._
      #if doi != none [#link("https://doi.org/" + doi)[https://doi.org/#doi]] else if url != none [#link(url)]
    ])
    item("DOI", if doi != none [#link("https://doi.org/" + doi)[#doi]] else [
      Jedes Release wird auf Zenodo archiviert und erhält dort eine DOI. Sie steht dann hier.
    ])
    item("Lizenz", [
      Text: #link("https://creativecommons.org/licenses/by/4.0/deed.de")[CC BY 4.0]. Software:
      #link("https://eupl.eu/1.2/de/")[EUPL-1.2].
    ])
    item("Interessenkonflikte", [
      Ich erkläre, dass keine Interessenkonflikte bestehen. Feldspur ist mein eigenes Forschungswerkzeug und
      (noch) kein Produkt; ich verdiene daran nichts. Wohlgemerkt: Ich entwickle das Werkzeug und forsche
      zugleich damit. Das prägt meinen Blick darauf, auch beim Schreiben dieses Handbuchs.
    ])
    item("Generative KI", [
      Feldspur ist zu großen Teilen mit generativer KI (Claude, Anthropic) entwickelt worden. Wie, steht im
      Abschnitt „Entstehung mit generativer KI“.
    ])
  }

  // Inhaltsverzeichnis auf eigener (rechter) Seite
  if toc {
    pagebreak(to: "odd")
    outline(title: toc_title, depth: toc_depth, indent: toc_indent)
  }

  // Inhalt beginnt auf einer rechten Seite; ab hier Kopf- und Fußzeile.
  pagebreak(to: "odd")
  context body-start.update(here().page())

  if cols == 1 { doc } else { columns(cols, doc) }
}

#set table(inset: 6pt, stroke: none)
