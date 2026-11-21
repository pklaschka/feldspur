// Seitenaufbau des PDF-Handbuchs (ersetzt Quartos article-Vorlage, siehe template-partials in _quarto.yml).
// Für beidseitigen Druck: innen breiterer Rand, Seitenzahl und Randmarke außen, Kopfzeile mit dem Kapitel
// auf rechten Seiten. Vorne: Titelseite, Rückseite mit Angaben (Zitieren, Lizenz, Interessenkonflikte),
// Inhaltsverzeichnis auf eigener Seite. Hinten: Leerseiten bis zu einem Vielfachen von vier Seiten (Broschüre)
// und ein Rückumschlag. Farben und Schriften kommen aus kopf.typ.
// Druckfassung (Profil „druck“, _quarto-druck.yml): `beschnitt` legt rundum eine Beschnittzugabe an. Die Seite
// wächst um zweimal den Beschnitt, alle Ränder um einmal, sodass der Inhalt nach dem Schneiden genau wie in der
// normalen Fassung steht. Randabfallendes (Randmarke, Rückumschlag) läuft in den Beschnitt hinein.
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


// Notizseite zum Auffüllen der Broschüre: wie ein Feldbuch, Punkte im 5-mm-Raster über den Satzspiegel.
#let notizseite() = {
  text(font: sans, size: 9pt, weight: "semibold", fill: tinte-2, tracking: 0.04em)[NOTIZEN]
  v(3mm)
  layout(size => {
    let schritt = 5mm
    let spalten = int(size.width / schritt)
    let zeilen = int((size.height - 1mm) / schritt)
    for z in range(zeilen + 1) {
      for s in range(spalten + 1) {
        place(dx: s * schritt - 0.5pt, dy: z * schritt - 0.5pt, circle(radius: 0.5pt, fill: sand.darken(12%)))
      }
    }
  })
}

// Rückumschlag: Umbra wie der Stab der Randmarke, oben die Fahne in Terrakotta, Text hell.
#let rueckumschlag(title: none, subtitle: none, authors: none, date: none, url: none, doi: none, font: none, beschnitt: 0mm) = {
  let hell = rgb("#f4efe6")
  let gedaempft = sand
  page(
    fill: umbra,
    margin: (x: 24mm + beschnitt, top: 30mm + beschnitt, bottom: 26mm + beschnitt),
    header: none,
    footer: none,
    // Die Randmarke läuft hier über die ganze Breite: oben Terrakotta, dann Umbra (die Seitenfarbe).
    background: place(top, rect(width: 100%, height: 22mm + beschnitt, fill: terrakotta)),
  )[
    #set par(justify: false)
    #set text(fill: hell, hyphenate: false)
    #show link: set text(fill: hell)
    #v(10mm)
    #text(font: font, weight: "semibold", size: 30pt)[#title]
    #v(1mm)
    #text(font: font, style: "italic", size: 14pt, fill: gedaempft)[Begleittext und Handbuch]
    #v(8mm)
    #block(width: 86%, {
      set par(leading: 0.7em, justify: false)
      set text(size: 12pt)
      [Ethnografische Feldeinsätze hinterlassen Tagebuchseiten, Fotos, Audio- und Videoaufnahmen, oft von vielen
        Geräten, deren Uhren selten übereinstimmen. Feldspur legt dieses Material nach Uhrzeit auf eine gemeinsame
        Achse, macht jede Zuordnung über sichtbare Zeitbelege nachvollziehbar und erzeugt daraus ein Dokument mit
        Zeitmarken für die Analyse in MAXQDA u. Ä.]
      v(4mm)
      [Der Begleittext erzählt, warum es Feldspur gibt, ordnet es in bestehende Werkzeuge ein und legt offen, wie
        es mithilfe generativer KI entstanden ist. Das Handbuch führt Schritt für Schritt durch die Arbeit mit dem
        Programm.]
    })
    #v(1fr)
    #image("bilder/logo.svg", width: 16mm)
    #v(5mm)
    #set text(font: sans, size: 9.5pt)
    #if authors != none {
      for a in authors {
        text(weight: "semibold", size: 11pt)[#a.name]
        linebreak()
      }
    }
    #text(fill: gedaempft)[
      #if date != none [Stand: #date \ ]
      #if doi != none [Software-DOI #link("https://doi.org/" + doi)[#doi] \ ]
      Online: #link("https://purl.archive.org/feldspur")[purl.archive.org/feldspur] \
      PDF: #link("https://purl.archive.org/feldspur/pdf")[purl.archive.org/feldspur/pdf] \
      Programm: #link("https://purl.archive.org/feldspur/repo")[purl.archive.org/feldspur/repo] \
      Text CC BY 4.0 · Software EUPL-1.2
    ]
  ]
}

#set table(inset: 6pt, stroke: none)

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
  beschnitt: 0mm,
  herausgabe: none,
  druck: none,
  doc,
) = {
  set par(justify: true)
  set text(lang: lang, region: region, font: font, size: fontsize, hyphenate: true)
  set heading(numbering: sectionnumbering)
  // Pandoc maskiert „/“ in Zeichenketten als „\/“.
  if url != none { url = url.replace("\\/", "/") }

  // Ab hier zählt der Inhalt: Kopf- und Fußzeile erst danach, auf Vorsatzseiten nichts.
  let body-start = state("fs-body-start", none)
  // Ab hier nur noch Leerseiten und Rückumschlag: wieder ohne Kopf- und Fußzeile.
  let body-end = state("fs-body-end", none)

  let b = beschnitt
  // Endformat A4; mit Beschnitt entsprechend größer (bei 3 mm: 216 × 303 mm).
  set page(width: 210mm + 2 * b, height: 297mm + 2 * b)
  set page(
    margin: (inside: 27mm + b, outside: 21mm + b, top: 26mm + b, bottom: 24mm + b),
    // Kopf- und Fußzeile fest vom Seitenrand aus (Typsts Vorgabe: 30 % des Rands), damit sie mit Beschnitt
    // nicht wandern.
    header-ascent: 7.8mm,
    footer-descent: 7.2mm,
    binding: left,
    // Randmarke außen: oben ein Stück Terrakotta (die Fahne), darunter Umbra (der Stab).
    background: context {
      // Auch Leerseiten tragen die Randmarke, damit der gedruckte Block durchgehend gleich aussieht.
      let side = if calc.odd(here().page()) { right } else { left }
      place(side + top, stack(
        rect(width: 3mm + b, height: 22mm + b, fill: terrakotta),
        rect(width: 3mm + b, height: 100%, fill: umbra),
      ))
    },
    header: context {
      let start = body-start.get()
      if start == none or here().page() <= start { return }
      let end = body-end.get()
      if end != none and here().page() > end { return }
      let p = here().page()
      // Beginnt oben auf der Seite ein Kapitel, steht sein Titel schon groß da: keine Kopfzeile.
      if query(heading.where(level: 1)).any(k => k.location().page() == p and k.location().position().y < 45mm + b) { return }
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
      let end = body-end.get()
      if end != none and here().page() > end { return }
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
    // Kein Vorspann über dem Titel: „Begleittext und Handbuch“ steht schon im Untertitel.
    v(6mm)
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
      text(font: sans, size: 9.5pt, fill: tinte-2)[Software-DOI #link("https://doi.org/" + doi)[#doi]]
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
    // Kurze Zeilen lesen sich bei 9 pt besser als die volle Satzbreite.
    set block(width: 118mm)
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
      #if url != none [#link(url)]
    ])
    item("Software-DOI", if doi != none [
      #link("https://doi.org/" + doi)[#doi] (Feldspur, alle Versionen). Zenodo archiviert mit jedem Release
      den Quellcode, also auch den dieses Texts, nicht aber das PDF selbst.
    ] else [
      Jedes Release wird auf Zenodo archiviert und erhält dort eine DOI. Sie steht dann hier.
    ])
    item("Lizenz", [
      Text: #link("https://creativecommons.org/licenses/by/4.0/deed.de")[CC BY 4.0]. Software:
      #link("https://eupl.eu/1.2/de/")[EUPL-1.2].
    ])
    // Druckfassung (Profil „druck“): Impressum nach Art. 7 BayPrG, nur wenn die Angaben gesetzt sind.
    if herausgabe != none or druck != none {
      item("Impressum", [
        #if herausgabe != none [Herausgeberin (Selbstverlag): #herausgabe \ ]
        #if druck != none [Druck: #druck]
      ])
    }
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

  // Für den Druck als Broschüre (gefalzte Bögen zu je vier Seiten) hat das PDF immer ein Vielfaches von vier
  // Seiten: nach dem Inhalt so viele Leerseiten (mit Randmarke, ohne Kopf- und Fußzeile), dass der
  // Rückumschlag auf die letzte Seite fällt.
  [#metadata("ende") <fs-ende>]
  context {
    let last = locate(<fs-ende>).page()
    body-end.update(last)
    // Seiten insgesamt mit Rückumschlag: last + leer + 1, durch vier teilbar.
    let leer = calc.rem(4 - calc.rem(last + 1, 4), 4)
    // Jede Leerseite als eigene Seite (zwei pagebreak() hintereinander ergäben nur eine). Damit sie nicht wie
    // ein Fehler aussehen, werden sie Notizseiten: Überschrift klein in Sans, darunter ein feines Punktraster.
    for _ in range(leer) { page(notizseite()) }
  }
  rueckumschlag(title: title, subtitle: subtitle, authors: authors, date: date, url: url, doi: doi, font: font, beschnitt: b)
}
