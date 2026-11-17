-- Überschriften ohne Nummer (z. B. „Literatur“) im PDF als schlichtes #heading setzen.
-- Quarto packt sie sonst in einen eigenen #block[…]; dann gilt der Abstand der Überschrift nach oben
-- nicht, und sie hängt mit normalem Absatzabstand am vorigen Text.
if not quarto.doc.is_format("typst") then
  return {}
end

function Header(el)
  if not el.classes:includes("unnumbered") then
    return nil
  end
  local inhalt = pandoc.write(pandoc.Pandoc({ pandoc.Plain(el.content) }), "typst")
  local label = el.identifier ~= "" and ("\n<" .. el.identifier .. ">") or ""
  local outlined = el.classes:includes("unlisted") and ", outlined: false" or ""
  return pandoc.RawBlock(
    "typst",
    "#heading(level: " .. el.level .. ", numbering: none" .. outlined .. ")[" .. inhalt:gsub("%s+$", "") .. "]" .. label
  )
end
