// Tastenkürzel-Spickblatt (Issue #69): eine Seite DIN A4 quer zum Ausdrucken und neben die Tastatur Legen.
// Gestaltet nach dem Feldspur-Infografik-Leitfaden: Raster E (Werte der Zeile „A4“ im Leitfaden), Linien ½ E,
// Abstände 2 E / 4 E / 8 E, Schrift 9 / 18 / 27 pt, Titel kursiv, Erdtöne, Versatzschatten nur für das Wichtigste.
// Druckfreundlich: weißes Papier, keine vollflächigen Hintergründe.
//
// Jede Karte zeigt die Tasten so angeordnet wie auf der Tastatur und oben rechts eine kleine Tastatur, auf der
// die Tasten der Karte markiert sind. So bleibt hängen, wo eine Taste liegt, bevor das Kürzel sitzt.
//
// Die Kürzel stammen aus dem Code (apps/desktop/src/renderer: transcribe.ts, Transcriber.tsx, transcriber/Line.tsx,
// app/history.tsx, app/SessionPane.tsx, App.tsx, DiaryEditor.tsx, diary/EntryCard.tsx, MontageView.tsx,
// FineAlign.tsx, SearchDialog.tsx, Notes.tsx, Review.tsx, context/ContextStrip.tsx, keys.ts). Ändert sich dort
// etwas, hier nachziehen.
//
// Bauen: läuft mit `quarto render handbuch` (post-render spickblatt.ts) und landet als
// Feldspur-Tastenkuerzel.pdf neben dem Handbuch. Von Hand:
//   quarto typst compile --font-path handbuch/schriften handbuch/spickblatt/tastenkuerzel.typ

// ---------- Raster und Farben (Leitfaden, Zeile „A4“) ----------
#let E = 1.6mm
#let linie = 0.8mm
#let tinte = rgb("#26241f")
#let grau = rgb("#5b5d53")
#let hilfslinie = rgb("#e2d6c2")
#let creme = rgb("#f3e6d1")
#let sand = rgb("#e8d6b8")
#let papier = rgb("#fbf4e8")
#let weiss = rgb("#ffffff")
#let terrakotta = rgb("#a8452c")
#let gruen = rgb("#7f8f5a")
#let gruen-1 = rgb("#eef1e4")
#let gruen-5 = rgb("#4f5a33")
#let ocker = rgb("#c49a6c")
#let video = rgb("#8c8577")
#let umbra = rgb("#3a281d")

#let sans = ("Source Sans 3", "DejaVu Sans")

#set document(title: "Feldspur – Tastenkürzel", author: "Zuri Nimca Klaschka")
#set page(paper: "a4", flipped: true, margin: (x: 4 * E + 2mm, top: 4 * E, bottom: 3 * E), fill: weiss)
#set text(font: sans, size: 9pt, fill: tinte, lang: "de", number-type: "lining")
#set par(leading: 0.45em, spacing: 0.6em)

// ---------- Icons: Linien-Icons der App (16er-Raster, runde Enden), als SVG gesetzt ----------
#let svg-icon(d, farbe: tinte, groesse: 5mm, staerke: 1.5, fuellung: none) = {
  let fill = if fuellung == none { "none" } else { fuellung.to-hex() }
  let quelle = (
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='"
      + d
      + "' fill='"
      + fill
      + "' stroke='"
      + farbe.to-hex()
      + "' stroke-width='"
      + str(staerke)
      + "' stroke-linecap='round' stroke-linejoin='round'/></svg>"
  )
  box(baseline: 15%, image(bytes(quelle), format: "svg", width: groesse))
}
#let ICON = (
  audio: "M8 2.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2ZM4 8a4 4 0 0 0 8 0M8 12v2.5",
  video: "M3 5.5h7.5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM11.5 8.2 15 6v6l-3.5-2.2",
  tagebuch: "M4 2.5h7.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4ZM4 2.5v11M2.8 5h2.4M2.8 8h2.4M2.8 11h2.4M7 5.5h3.5M7 8h3.5",
  rueckgaengig: "M5.5 3 2.5 6l3 3M2.5 6h7a4 4 0 0 1 0 8H7",
  wiederholen: "M10.5 3l3 3-3 3M13.5 6h-7a4 4 0 0 0 0 8H9",
  suchen: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.5 10.5 14 14",
  vergroessern: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.5 10.5 14 14M5 7h4M7 5v4",
  verkleinern: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.5 10.5 14 14M5 7h4",
  ordner: "M2 4.5a1 1 0 0 1 1-1h3.2l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z",
  // Wiedergabe (für die Tasten selbst, im selben Strich wie die App-Icons)
  spielen: "M3 3.2v9.6L9.5 8ZM12 3.5v9M14.5 3.5v9",
  zurueck: "M8 3.5 3.5 8 8 12.5M13 3.5 8.5 8l4.5 4.5",
  vor: "M8 3.5 12.5 8 8 12.5M3 3.5 7.5 8 3 12.5",
  langsam: "M2 11.5a6 6 0 0 1 12 0M8 11.5 5.2 7",
  zeile: "M13 3v5.5H3.5M6.5 5.5l-3 3 3 3",
  teilen: "M2.5 5h11M2.5 11h11M8 6.5v3",
  hoch: "M8 13V3M4 7l4-4 4 4",
  runter: "M8 3v10M4 9l4 4 4-4",
  maus: "M8 1.5a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0v-5a4 4 0 0 1 4-4ZM8 4v2.5",
  tippen: "M2 4.5h12v7H2ZM4.5 7h.01M7 7h.01M9.5 7h.01M5 9.5h6",
)
#let icon(name, ..args) = svg-icon(ICON.at(name), ..args)

// ---------- Taste ----------
// Aktive Tasten: Kartenweiß mit kräftigem Rand in der Farbe der Karte. Nachbartasten zur Orientierung nur als
// helle Fläche ohne Rand.
#let taste(
  name,
  breite: 1,
  u: 12mm,
  farbe: tinte,
  aktiv: true,
  symbol: none,
  groesse: 9pt,
  hoehe: none,
  mitte: false,
) = {
  let h = if hoehe == none { u } else { hoehe }
  let w = breite * u + (breite - 1) * E
  box(
    width: w,
    height: h,
    fill: if aktiv { weiss } else { papier },
    stroke: if aktiv { linie + farbe } else { (thickness: linie / 2, paint: hilfslinie, dash: none) },
    radius: if u >= 14mm { 2 * E } else { E },
    inset: (x: 0.9 * E, y: 0.8 * E),
    {
      set text(size: groesse, weight: "semibold", fill: if aktiv { tinte } else { grau.lighten(25%) })
      if mitte { place(center + horizon, text(size: groesse * 1.3, name)) } else { place(top + left, name) }
      if symbol != none {
        place(bottom + right, icon(symbol, farbe: farbe, groesse: calc.min(h * 0.42, 7mm), staerke: 1.6))
      }
    },
  )
}
#let plus = box(inset: (x: 0.6 * E), baseline: -30%, text(size: 12pt, weight: "bold", fill: grau, "+"))
#let oder = box(inset: (x: 0.6 * E), baseline: -30%, text(size: 9pt, fill: grau, "oder"))

// Kürzel mit Erklärung darunter (Tasten oben, Text unten). Der Text bricht nur, wo ein \\ steht.
#let kuerzel(tasten, text-oben, text-unten: none) = stack(
  spacing: 1.2 * E,
  box(tasten),
  {
    set par(leading: 0.4em)
    text(weight: "semibold", text-oben)
    if text-unten != none {
      linebreak()
      text(fill: grau, text-unten)
    }
  },
)

// ---------- Kleine Tastatur (deutsches ISO-Layout) mit markierten Tasten ----------
// Zeilen als (id, x, breite) in Tasteneinheiten; y je Zeile.
#let TASTATUR = {
  let r = ()
  // Funktionsreihe
  r.push(("esc", 0, 0, 1))
  for i in range(4) { r.push(("f" + str(i + 1), 2 + i, 0, 1)) }
  for i in range(4) { r.push(("f" + str(i + 5), 6.5 + i, 0, 1)) }
  for i in range(4) { r.push(("f" + str(i + 9), 11 + i, 0, 1)) }
  for (i, k) in ("druck", "rollen", "pause").enumerate() { r.push((k, 15.25 + i, 0, 1)) }
  // Ziffernreihe
  for (i, k) in ("^", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "ß", "´").enumerate() { r.push((k, i, 1.5, 1)) }
  r.push(("rueck", 13, 1.5, 2))
  for (i, k) in ("einfg", "pos1", "bildauf").enumerate() { r.push((k, 15.25 + i, 1.5, 1)) }
  // Q-Reihe
  r.push(("tab", 0, 2.5, 1.5))
  for (i, k) in ("q", "w", "e", "r", "t", "z", "u", "i", "o", "p", "ü", "+").enumerate() { r.push((k, 1.5 + i, 2.5, 1)) }
  r.push(("enter", 13.5, 2.5, 1.5))
  for (i, k) in ("entf", "ende", "bildab").enumerate() { r.push((k, 15.25 + i, 2.5, 1)) }
  // A-Reihe
  r.push(("caps", 0, 3.5, 1.75))
  for (i, k) in ("a", "s", "d", "f", "g", "h", "j", "k", "l", "ö", "ä", "#").enumerate() { r.push((k, 1.75 + i, 3.5, 1)) }
  r.push(("enter", 13.75, 3.5, 1.25))
  // Y-Reihe
  r.push(("umschalt", 0, 4.5, 1.25))
  for (i, k) in ("<", "y", "x", "c", "v", "b", "n", "m", ",", ".", "-").enumerate() { r.push((k, 1.25 + i, 4.5, 1)) }
  r.push(("umschalt", 12.25, 4.5, 2.75))
  r.push(("hoch", 16.25, 4.5, 1))
  // Leertastenreihe
  r.push(("strg", 0, 5.5, 1.25))
  r.push(("win", 1.25, 5.5, 1.25))
  r.push(("alt", 2.5, 5.5, 1.25))
  r.push(("leer", 3.75, 5.5, 6.25))
  r.push(("altgr", 10, 5.5, 1.25))
  r.push(("win", 11.25, 5.5, 1.25))
  r.push(("menue", 12.5, 5.5, 1.25))
  r.push(("strg", 13.75, 5.5, 1.25))
  for (i, k) in ("links", "runter", "rechts").enumerate() { r.push((k, 15.25 + i, 5.5, 1)) }
  r
}
#let mini-tastatur(markiert, farbe: tinte, breite: 46mm) = {
  let u = breite / 18.25
  let s = u * 0.12
  box(width: breite, height: 6.5 * u, {
    for (id, x, y, w) in TASTATUR {
      let an = id in markiert
      place(dx: x * u + s / 2, dy: y * u + s / 2, rect(
        width: w * u - s,
        height: u - s,
        radius: 0.35mm,
        fill: if an { farbe } else { hilfslinie.lighten(20%) },
        stroke: none,
      ))
    }
  })
}

// ---------- Karte ----------
// Weiße Karte mit kräftigem Rand. `hervor`: Versatzschatten (Creme, 1 E versetzt, gleicher Rand) für die
// wichtigste Karte.
#let karte(titel, farbe: tinte, symbol: none, markiert: (), hervor: false, breite: 100%, hoehe: auto, inhalt) = {
  let k = block(
    width: 100%,
    height: hoehe,
    fill: weiss,
    stroke: linie + farbe,
    radius: 2 * E,
    inset: (x: 2 * E + 1mm, top: 2 * E, bottom: 2 * E + 1mm),
    breakable: false,
    {
      grid(
        columns: (1fr, auto),
        align: (left + horizon, right + top),
        {
          if symbol != none { icon(symbol, farbe: farbe, groesse: 6mm, staerke: 1.4); h(1.2 * E) }
          text(size: if hervor { 18pt } else { 14pt }, weight: "bold", style: "italic", fill: farbe, titel)
        },
        mini-tastatur(markiert, farbe: farbe, breite: if hervor { 52mm } else { 30mm }),
      )
      v(2 * E, weak: true)
      inhalt
    },
  )
  if hervor {
    layout(platz => {
      let w = platz.width - E
      let m = measure(block(width: w, k))
      block(width: platz.width, height: m.height + E, {
        place(dx: E, dy: E, block(width: w, height: m.height, fill: creme, stroke: linie + farbe, radius: 2 * E))
        place(block(width: w, k))
      })
    })
  } else { block(width: breite, k) }
}

// Kleiner Abschnittstitel innerhalb einer Karte
#let zwischen(t, farbe: grau) = text(size: 9pt, weight: "bold", fill: farbe, tracking: 0.06em, upper(t))

// =====================================================================================================
// Kopf
// =====================================================================================================
#grid(
  columns: (auto, 1fr, auto),
  column-gutter: 2 * E,
  align: horizon,
  image("/bilder/logo.svg", width: 12mm),
  {
    text(size: 27pt, weight: "bold", style: "italic", fill: tinte)[Tastenkürzel]
    h(2 * E)
    text(size: 18pt, weight: "semibold", fill: terrakotta)[Feldspur]
  },
  align(right, block({
    set text(size: 9pt, fill: grau)
    set par(leading: 0.4em)
    [*Auf dem Mac:* Strg = ⌘ #h(1mm) · #h(1mm) Alt = ⌥ #h(1mm) · #h(1mm) Umschalt = ⇧ \
      F7–F9, Bild ↑ ↓, Pos1 und Ende mit #text(fill: tinte, weight: "semibold")[fn] (Bild ↑ = fn + ↑, Pos1 = fn + ←)]
  })),
)
#v(2 * E, weak: true)
#line(length: 100%, stroke: linie + terrakotta)
#v(3 * E, weak: true)

// =====================================================================================================
// Inhalt: links Mitschreiben (groß) und Tagebuch, rechts Überall, Montage, Feinabgleich, Maus
// =====================================================================================================
#let U = 17mm // Tastengröße in der Hauptkarte
#let u = 10.5mm // Tastengröße in den kleinen Karten

#grid(
  columns: (1fr, 92mm),
  column-gutter: 4 * E,
  // ---------------------------------------------------------------- links
  {
    karte(
      [Mitschreiben],
      farbe: terrakotta,
      symbol: "audio",
      hervor: true,
      markiert: ("esc", "f7", "f8", "f9", "enter", "strg", "alt", "hoch", "runter", "umschalt"),
      {
        zwischen[Wiedergabe – die Hände bleiben auf der Tastatur]
        v(1.5 * E, weak: true)
        // Funktionsreihe wie auf der Tastatur: Esc ganz links, F5–F8 als Block, F9 beginnt den letzten Block.
        let tk(n, ..a) = taste(n, u: U, farbe: terrakotta, groesse: 14pt, ..a)
        let leer(n) = taste(n, u: U, aktiv: false, groesse: 11pt)
        // `frei`: Der graue Text darf nach rechts über die Tastenbreite hinausragen, statt mitten im Satz zu brechen.
        let spalte(t1, t2, frei: false) = {
          set par(leading: 0.4em)
          text(weight: "semibold", t1)
          if t2 != none {
            linebreak()
            if frei { box(width: 3 * U, text(fill: grau, t2)) } else { text(fill: grau, t2) }
          }
        }
        grid(
          columns: (U, 4 * E, U, U, U, U, 2.5 * E, U, U),
          column-gutter: (0mm, 0mm, E, E, E, 0mm, 0mm, E),
          row-gutter: 1.2 * E,
          tk("Esc", symbol: "spielen"), [], leer("F5"), leer("F6"), tk("F7", symbol: "langsam"), tk("F8", symbol: "zurueck"), [], tk("F9", symbol: "vor"), leer("F10"),
          grid.cell(colspan: 4, spalte([Abspielen / Anhalten], [beim Weiterspielen 1 s zurück])),
          spalte([Langsamer], [⇧ = schneller · 0,5× bis 1,5×], frei: true),
          spalte([5 s zurück], none), [],
          spalte([5 s vor], none), [],
        )
        v(3 * E, weak: true)
        zwischen[Schreiben]
        v(1.5 * E, weak: true)
        let tm(n, ..a) = taste(n, u: 11.5mm, farbe: terrakotta, groesse: 10pt, ..a)
        grid(
          columns: (auto, auto, auto, 1fr),
          column-gutter: 4 * E,
          kuerzel(tm("Enter ↵", breite: 2, symbol: "zeile"), [Zeile fertig, \ nächste beginnt], text-unten: [Zeitmarke = Tippbeginn]),
          kuerzel(
            {
              tm("Strg", breite: 1.25)
              plus
              tm("Enter ↵", breite: 2)
            },
            [Zeile an der \ Schreibmarke teilen],
          ),
          kuerzel(
            {
              tm("Alt", breite: 1.25)
              plus
              box(stack(
                spacing: E / 2,
                tm("↑", hoehe: 5.5mm, groesse: 9pt, mitte: true),
                tm("↓", hoehe: 5.5mm, groesse: 9pt, mitte: true),
              ))
            },
            [Zeile davor / danach],
            text-unten: [ganz unten: neue Zeile],
          ),
          kuerzel(
            box(
              height: 11.5mm,
              width: 100%,
              stroke: (thickness: linie, paint: terrakotta, dash: "dashed"),
              radius: E,
              inset: (x: 1.2 * E),
              align(horizon, text(size: 14pt, weight: "semibold", font: ("Source Sans 3",))[B1: #text(fill: grau, weight: "regular")[Ja, genau …]]),
            ),
            [Zeilenanfang: Sprecher wechseln],
            text-unten: [Einfach lostippen: landet \ in der neuen Zeile],
          ),
        )
      },
    )
    v(3 * E, weak: true)
    // ---------------------------------------------------------------- Tagebuch
    karte(
      [Tagebuch abtippen],
      farbe: gruen-5,
      symbol: "tagebuch",
      markiert: ("bildauf", "bildab", "+", "-", "0", "strg", "alt", "hoch", "runter", "links", "rechts", "umschalt", "k"),
      {
        let tg(n, ..a) = taste(n, u: u, farbe: gruen-5, ..a)
        let lg(n, ..a) = taste(n, u: u, aktiv: false, ..a)
        let halb = (u - E / 2) / 2
        // Pfeiltasten wie auf der Tastatur (umgekehrtes T), so hoch wie eine Taste
        let pfeile = box(grid(
          columns: 3,
          gutter: E / 2,
          [], taste("↑", u: 7mm, hoehe: halb, farbe: gruen-5, mitte: true), [],
          ..("←", "↓", "→").map(p => taste(p, u: 7mm, hoehe: halb, farbe: gruen-5, mitte: true)),
        ))
        // Gewählter Eintragsrahmen: Nummernschild oben links, Griffe an Ecken und Kanten
        let rahmen = box(width: 30mm, height: u, {
          let griff(pos) = place(pos, rect(width: 1.6mm, height: 1.6mm, fill: weiss, stroke: linie / 2 + gruen-5))
          place(dx: 0.8mm, dy: 0.8mm, rect(
            width: 100% - 1.6mm,
            height: 100% - 1.6mm,
            stroke: (thickness: linie, paint: gruen-5, dash: "dashed"),
          ))
          for pos in (top + center, top + right, horizon + left, horizon + right, bottom + left, bottom + center, bottom + right) {
            griff(pos)
          }
          place(top + left, box(
            fill: gruen-5,
            radius: 0.4mm,
            inset: (x: 1.3mm, y: 0.9mm),
            text(size: 9pt, weight: "bold", fill: weiss)[2],
          ))
          place(center + horizon, dx: 2mm, text(size: 12pt, fill: grau)[14:05 #h(0.5mm) …])
        })
        grid(
          columns: (auto, 1fr),
          column-gutter: 4 * E,
          kuerzel(
            grid(
              columns: 3,
              gutter: E,
              lg("Einfg"), lg("Pos1"), tg("Bild ↑"),
              lg("Entf"), lg("Ende"), tg("Bild ↓"),
            ),
            [Vorige / nächste Seite],
            text-unten: [auch beim Tippen],
          ),
          {
            grid(
              columns: (37mm, auto, 1fr),
              column-gutter: 4 * E,
              kuerzel(
                {
                  tg("+", symbol: "vergroessern")
                  h(E)
                  tg("−", symbol: "verkleinern")
                  h(E)
                  tg("0")
                },
                [Zoomen · ganze Seite],
                text-unten: [außerhalb von Textfeldern],
              ),
              kuerzel(
                {
                  tg("Strg", breite: 1.25)
                  plus
                  taste([Rad], u: u, farbe: gruen-5, symbol: "maus")
                },
                [Zoomen an der Maus],
              ),
              kuerzel(
                {
                  box(stack(spacing: E / 2, tg("↑", hoehe: halb, mitte: true), tg("↓", hoehe: halb, mitte: true)))
                  h(E)
                  box(
                    height: u,
                    stroke: (thickness: linie, paint: gruen-5, dash: "dashed"),
                    radius: E,
                    inset: (x: 1.2 * E),
                    align(horizon, text(size: 12pt, weight: "semibold")[1030 #text(fill: grau, weight: "regular")[→ 10:30]]),
                  )
                },
                [„Notiert um“: ± 1 Minute],
                text-unten: [mit ⇧ ± 10 Min. · leer: *K* = Kontext],
              ),
            )
            v(2.5 * E, weak: true)
            // Rahmen des gewählten Eintrags nachbessern (Tastatur: Nummernschild fokussiert)
            grid(
              columns: (37mm, auto, 1fr),
              column-gutter: 4 * E,
              kuerzel(pfeile, [Rahmen verschieben], text-unten: [Nummer fokussiert]),
              kuerzel(
                {
                  tg("Alt", breite: 1.25)
                  plus
                  pfeile
                },
                [Rahmengröße ändern],
                text-unten: [beides mit ⇧: große Schritte],
              ),
              kuerzel(
                {
                  rahmen
                  h(E)
                  box(height: u, align(horizon, icon("maus", farbe: gruen-5, groesse: 6mm, staerke: 1.4)))
                },
                [Rahmen mit der Maus ziehen],
                text-unten: [Nummer: Lage · Griffe: Größe],
              ),
            )
          },
        )
      },
    )
    v(2.5 * E, weak: true)
    // ---------------------------------------------------------------- Zeitachse (nur Maus)
    block(inset: (x: 2 * E + 1mm), {
      set text(fill: grau)
      icon("maus", farbe: umbra, groesse: 5mm, staerke: 1.4)
      h(1.2 * E)
      text(size: 11pt, weight: "bold", style: "italic", fill: umbra)[Zeitachse]
      h(2 * E)
      [*Mausrad* zoomt an der Maus #h(1.5mm)·#h(1.5mm) *⇧ + Mausrad* verschiebt die Achse #h(1.5mm)·#h(1.5mm)
        *Rad gedrückt ziehen* verschiebt auch]
    })
    v(1.5 * E, weak: true)
    // ---------------------------------------------------------------- Durchsehen (drei Kürzel)
    block(inset: (x: 2 * E + 1mm), {
      set text(fill: grau)
      icon("suchen", farbe: umbra, groesse: 5mm, staerke: 1.4)
      h(1.2 * E)
      text(size: 11pt, weight: "bold", style: "italic", fill: umbra)[Durchsehen]
      h(2 * E)
      [*N* nächste Stelle #h(1.5mm)·#h(1.5mm) *⇧ + N* vorige Stelle #h(1.5mm)·#h(1.5mm)
        *Strg + Enter* Lage passt #h(1.5mm)·#h(1.5mm) *Alt + ← →* Kontext umsortieren]
    })
  },
  // ---------------------------------------------------------------- rechts
  {
    let ts(n, farbe, ..a) = taste(n, u: u, farbe: farbe, ..a)
    karte(
      [Überall],
      farbe: tinte,
      markiert: ("strg", "o", "k", "z", "y", "umschalt"),
      {
        let z(t, ..a) = ts(t, tinte, ..a)
        let strg = z("Strg", breite: 1.25)
        grid(
          columns: (1fr, 1fr),
          column-gutter: 2 * E,
          row-gutter: 2.5 * E,
          kuerzel({ strg; plus; z("O", symbol: "ordner") }, [Projekt öffnen]),
          kuerzel({ strg; plus; z("K", symbol: "suchen") }, [Suchen], text-unten: [↑ ↓ wählen, Enter springt hin]),
          kuerzel({ strg; plus; z("Z", symbol: "rueckgaengig") }, [Rückgängig], text-unten: [im Textfeld erst der Text]),
          kuerzel(
            { strg; plus; z("Y", symbol: "wiederholen") },
            [Wiederholen],
            text-unten: [oder Strg + ⇧ + Z],
          ),
        )
        v(2.5 * E, weak: true)
        text(fill: grau)[#text(fill: tinte, weight: "semibold")[Strg + Enter] in einer Datei-Notiz: Notiz speichern]
      },
    )
    v(3 * E, weak: true)
    karte(
      [Montage ansehen],
      farbe: video,
      symbol: "video",
      markiert: ("leer", "links", "rechts", "pos1", "ende"),
      {
        let m(t, ..a) = ts(t, video, ..a)
        let lm(t) = taste(t, u: u, aktiv: false)
        grid(
          columns: (auto, auto),
          column-gutter: 4 * E,
          stack(
            spacing: 2.5 * E,
            kuerzel(m("Leertaste", breite: 3, symbol: "spielen"), [Abspielen / Anhalten]),
            kuerzel({ m("←", mitte: true); h(E); m("→", mitte: true) }, [10 s zurück / vor]),
          ),
          kuerzel(
            grid(columns: 3, gutter: E, lm("Einfg"), m("Pos1"), lm("Bild ↑"), lm("Entf"), m("Ende"), lm("Bild ↓")),
            [Anfang / Ende],
          ),
        )
      },
    )
    v(3 * E, weak: true)
    karte(
      [Feinabgleich (Ton)],
      farbe: gruen,
      markiert: ("leer", "links", "rechts", "umschalt"),
      {
        let f(t, ..a) = ts(t, gruen, ..a)
        grid(
          columns: (auto, 1fr),
          column-gutter: 3 * E,
          kuerzel({ f("←", mitte: true); h(E); f("→", mitte: true) }, [Zweite Spur verschieben], text-unten: [um 1 Bildpunkt, mit ⇧ um 10]),
          kuerzel(f("Leertaste", breite: 3, symbol: "spielen"), [Anhören], text-unten: [ab 1,5 s vor der Stelle]),
        )
      },
    )
  },
)

#v(1fr)
#grid(
  columns: (1fr, auto),
  align: (left + bottom, right + bottom),
  text(size: 7pt, fill: grau)[Mehr im Handbuch: purl.archive.org/feldspur],
  text(size: 7pt, fill: grau)[CC BY 4.0 · Zuri Nimca Klaschka],
)
