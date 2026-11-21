-- Im PDF bestimmt der Inhalt die Spaltenbreiten (Typst `auto`): Eine Spalte mit kurzen Begriffen wird so schmal
-- wie ihr längster Eintrag, die Spalten mit Fließtext teilen sich den Rest. Pandoc leitet sonst aus den Strichen
-- der Trennzeile feste Anteile ab, die zu kurzen Einträgen viel leeren Platz lassen.
function Table(t)
  if not FORMAT:match("typst") then return nil end
  for i, spec in ipairs(t.colspecs) do
    t.colspecs[i] = { spec[1], pandoc.ColWidthDefault }
  end
  return t
end
