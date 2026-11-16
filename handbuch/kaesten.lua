-- Hinweiskästen (Callouts) im PDF als schlichte Kästen setzen. Quartos eigene Typst-Kästen laden ein
-- Symbolpaket (@preview/fontawesome) aus dem Netz nach; so bleibt der Satz ohne Netz und ohne Fremdpakete.
function Div(el)
  local art
  for _, c in ipairs(el.classes) do
    art = art or c:match("^callout%-(%a+)")
  end
  if not art then return nil end
  -- Farben aus kopf.typ: Hinweis Ocker, Wichtig Terrakotta, Warnung Rost (Senf), Tipp Moos.
  local farbe = ({ important = "terrakotta", warning = "rost", caution = "rost", tip = "moos" })[art] or "ocker"
  local blocks = pandoc.List()
  blocks:insert(pandoc.RawBlock("typst", "#block(fill: papier, stroke: (left: 3pt + " .. farbe ..
    "), inset: 10pt, radius: (right: 3pt), width: 100%, breakable: false)["))
  for i, b in ipairs(el.content) do
    if i == 1 and b.t == "Header" then
      blocks:insert(pandoc.RawBlock("typst", "#text(font: sans)["))
      blocks:insert(pandoc.Para({ pandoc.Strong(b.content) }))
      blocks:insert(pandoc.RawBlock("typst", "]"))
    else
      blocks:insert(b)
    end
  end
  blocks:insert(pandoc.RawBlock("typst", "]"))
  return blocks
end
