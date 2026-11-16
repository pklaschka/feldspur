<!-- Erzeugt aus README.qmd und handbuch/ (vp run readme). Bitte dort ändern, nicht hier. -->
<div align="center">

<img src="packaging/icon.svg" alt="" width="112">

# $title$

_$tagline$_

$for(by-author)$**$it.name.literal$**$if(it.orcid)$ · [ORCID $it.orcid$](https://orcid.org/$it.orcid$)$endif$$sep$ · $endfor$<br>
Stand: $date$

[![Handbuch](https://img.shields.io/badge/Handbuch-online-a4441f)](https://pklaschka.github.io/feldspur/)
[![Neueste Version](https://img.shields.io/github/v/release/pklaschka/feldspur?include_prereleases&label=Version&color=3a281d)](https://github.com/pklaschka/feldspur/releases)
[![CI](https://github.com/pklaschka/feldspur/actions/workflows/ci.yml/badge.svg)](https://github.com/pklaschka/feldspur/actions/workflows/ci.yml)
[![Windows · macOS · Linux](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-44692f)](https://github.com/pklaschka/feldspur/releases)
[![Lizenz: EUPL-1.2](https://img.shields.io/badge/Lizenz-EUPL--1.2-5b5d53)](LICENSE)
[![Text: CC BY 4.0](https://img.shields.io/badge/Text-CC%20BY%204.0-5b5d53)](https://creativecommons.org/licenses/by/4.0/deed.de)

</div>

$if(abstract)$
**Zusammenfassung.** $abstract$
$endif$

$if(keywords)$
**Schlüsselwörter:** $for(keywords)$$keywords$$sep$, $endfor$
$endif$

$body$
