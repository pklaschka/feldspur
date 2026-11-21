-- PDF: Ein Satz, der mit Doppelpunkt eine Liste einleitet, bleibt mit ihr auf derselben Seite (Typst `sticky`).
-- Sonst steht er allein unten auf der Seite und die Liste beginnt erst auf der nächsten.
function Blocks(blocks)
  if not FORMAT:match("typst") then return nil end
  local out = pandoc.List()
  for i, b in ipairs(blocks) do
    local naechster = blocks[i + 1]
    local text = b.t == "Para" and pandoc.utils.stringify(b) or ""
    if text:match(":%s*$") and naechster and (naechster.t == "BulletList" or naechster.t == "OrderedList") then
      out:insert(pandoc.RawBlock("typst", "#block(sticky: true)["))
      out:insert(b)
      out:insert(pandoc.RawBlock("typst", "]"))
    else
      out:insert(b)
    end
  end
  return out
end
