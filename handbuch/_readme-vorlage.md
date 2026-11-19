<!-- Erzeugt aus README.qmd und handbuch/ (vp run readme). Bitte dort ändern, nicht hier. -->
<div align="center">

<img src="packaging/icon.svg" alt="" width="112">

# $title$<br><sub><sub><em>$tagline$</em></sub></sub>

$for(by-author)$**$it.name.literal$**$if(it.orcid)$ <a href="https://orcid.org/$it.orcid$"><img src="https://orcid.org/assets/vectors/orcid.logo.icon.svg" width="16" alt="ORCID $it.orcid$"></a>$endif$$sep$ · $endfor$<br>
Stand: $date$

[![Handbuch](https://img.shields.io/badge/Handbuch-online-a4441f?labelColor=3a281d)](https://purl.archive.org/feldspur)
[![DOI](https://img.shields.io/badge/DOI-10.5281%2Fzenodo.24289969-5b5d53?labelColor=3a281d)](https://doi.org/10.5281/zenodo.24289969)
[![In Lieferling installieren](https://img.shields.io/badge/macOS-In%20Lieferling%20installieren-a4441f?labelColor=3a281d)](https://pklaschka.github.io/lieferling/?repo=pklaschka/feldspur&install=1)
[![Version](https://img.shields.io/github/package-json/v/pklaschka/feldspur?label=Version&labelColor=3a281d&color=5b5d53)](https://github.com/pklaschka/feldspur/releases)
[![Plattformen](https://img.shields.io/badge/Plattformen-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-5b5d53?labelColor=3a281d)](https://github.com/pklaschka/feldspur/releases)
[![Lizenz](https://img.shields.io/badge/Lizenz-EUPL--1.2%20%C2%B7%20Text%20CC%20BY%204.0-5b5d53?labelColor=3a281d)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/pklaschka/feldspur/ci.yml?label=CI&labelColor=3a281d&color=44692f)](https://github.com/pklaschka/feldspur/actions/workflows/ci.yml)

</div>

> **Zusammenfassung.** $abstract/chomp$
>
> **Schlüsselwörter:** $for(keywords)$$keywords$$sep$, $endfor$

$body$
