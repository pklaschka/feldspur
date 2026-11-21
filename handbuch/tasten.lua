-- Tastenkürzel als Tastenkappen: `[Strg+O]{.kbd}` wird im PDF zu gezeichneten Tasten (`tasten` in kopf.typ), in
-- HTML und README zu <kbd>Strg</kbd>+<kbd>O</kbd>. Zwischen Tasten stehen „+“ (zusammen drücken) oder „/“ (oder).
-- Eine Taste, die selbst „+“ oder „/“ heißt, steht allein: `[+]{.kbd}`.

local function teile(text)
  if text == "+" or text == "/" then return { text } end
  local liste, taste = {}, ""
  for _, c in utf8.codes(text) do
    local z = utf8.char(c)
    if (z == "+" or z == "/") and taste:match("%S") then
      table.insert(liste, (taste:gsub("^%s+", ""):gsub("%s+$", "")))
      table.insert(liste, z)
      taste = ""
    else
      taste = taste .. z
    end
  end
  table.insert(liste, (taste:gsub("^%s+", ""):gsub("%s+$", "")))
  return liste
end

local function typst_string(s)
  return '"' .. s:gsub("\\", "\\\\"):gsub('"', '\\"') .. '"'
end

local function html_escape(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

function Span(el)
  if not el.classes:includes("kbd") then return nil end
  local liste = teile(pandoc.utils.stringify(el))
  if FORMAT:match("typst") then
    local args = {}
    for _, t in ipairs(liste) do table.insert(args, typst_string(t)) end
    return pandoc.RawInline("typst", "#tasten(" .. table.concat(args, ", ") .. ",)")
  end
  if FORMAT:match("html") or FORMAT:match("gfm") or FORMAT:match("markdown") then
    local out = {}
    for i, t in ipairs(liste) do
      if i % 2 == 1 then table.insert(out, "<kbd>" .. html_escape(t) .. "</kbd>")
      else table.insert(out, html_escape(t)) end
    end
    return pandoc.RawInline("html", table.concat(out))
  end
  return pandoc.Str(table.concat(liste))
end
