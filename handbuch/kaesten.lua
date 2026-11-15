-- Hinweiskästen (Callouts) im PDF als schlichte Kästen setzen. Quartos eigene Typst-Kästen laden ein
-- Symbolpaket (@preview/fontawesome) aus dem Netz nach; so bleibt der Satz ohne Netz und ohne Fremdpakete.
function Div(el)
  local callout = false
  for _, c in ipairs(el.classes) do
    if c:match("^callout") then callout = true end
  end
  if not callout then return nil end
  local blocks = pandoc.List()
  blocks:insert(pandoc.RawBlock("typst",
    "#block(fill: luma(244), stroke: (left: 3pt + luma(150)), inset: 10pt, width: 100%, breakable: true)["))
  for i, b in ipairs(el.content) do
    if i == 1 and b.t == "Header" then
      blocks:insert(pandoc.Para({ pandoc.Strong(b.content) }))
    else
      blocks:insert(b)
    end
  end
  blocks:insert(pandoc.RawBlock("typst", "]"))
  return blocks
end
