-- Gerade Anführungszeichen im Quelltext ("…") werden von Pandoc als Zitat erkannt. Typst setzt sie je nach
-- Sprache selbst richtig, HTML und GFM aber englisch (“…”). Dieser Filter setzt für Deutsch „…“ und ‚…‘.
function Quoted(el)
  if FORMAT:match("typst") then return nil end
  local auf, zu = "„", "“"
  if el.quotetype == "SingleQuote" then auf, zu = "‚", "‘" end
  local inhalt = pandoc.List({ pandoc.Str(auf) })
  inhalt:extend(el.content)
  inhalt:insert(pandoc.Str(zu))
  return inhalt
end
