#!/usr/bin/env bash
# Baut ffmpeg/ffprobe als LGPL-Fassung aus den offiziellen Quellen (macOS).
# Nur eingebaute Codecs plus Apples VideoToolbox/AudioToolbox und die zlib aus dem
# macOS-SDK; keine GPL-Teile, keine Bibliotheken aus Homebrew (--disable-autodetect).
#
#   scripts/build-ffmpeg-macos.sh <release-linie, z. B. 8.1> <zielordner>
#
# Wird von scripts/fetch-ffmpeg.mjs aufgerufen (lokal und im Paket-Workflow .github/workflows/package.yml), nicht
# von Hand. Legt neben ffmpeg und ffprobe die Lizenz (LICENSE.txt) und einen Nachweis des Builds (BUILD.txt: Quelle,
# SHA-256 des Quellarchivs, Konfiguration) ab; fetch-ffmpeg.mjs vergleicht diese Prüfsumme mit der dort hinterlegten.
set -euo pipefail

line="$1"
out="$2"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

url="https://ffmpeg.org/releases/ffmpeg-${line}.tar.xz"
echo "Lade $url …"
curl -fsSL "$url" -o "$work/src.tar.xz"
shasum -a 256 "$work/src.tar.xz" | tee "$work/sha256.txt"
tar -xf "$work/src.tar.xz" -C "$work"
cd "$work/ffmpeg-${line}"

# nasm beschleunigt nur x86; auf Apple Silicon nicht nötig.
config=(
  --prefix="$work/install"
  --disable-gpl --disable-nonfree --disable-version3
  --disable-autodetect
  # zlib (zlib-Lizenz, Teil von macOS) ausdrücklich einschalten: --disable-autodetect schaltet
  # sie sonst ab, und ohne zlib fehlen PNG- und TIFF-Decoder. Die Einblendungen im
  # Montagevideo sind PNG-Bilder, die Ausgabe scheiterte daran.
  --enable-zlib
  --enable-videotoolbox --enable-audiotoolbox
  --disable-ffplay --disable-doc --disable-debug
  --disable-network
  --enable-static --disable-shared
  --extra-cflags="-mmacosx-version-min=12.0" --extra-ldflags="-mmacosx-version-min=12.0"
)
if [[ "$(uname -m)" == "x86_64" ]] && ! command -v nasm >/dev/null; then config+=(--disable-x86asm); fi

./configure "${config[@]}"
make -j"$(sysctl -n hw.ncpu)"

rm -rf "$out"
mkdir -p "$out"
cp ffmpeg ffprobe "$out/"
cp COPYING.LGPLv2.1 "$out/LICENSE.txt"
# Sicherung: Die Versionszeile nennt die Konfiguration. Stünde dort GPL oder nonfree, dürfte der Build nicht ins Paket.
version="$("$out/ffmpeg" -hide_banner -version)"
if grep -qE -- "--enable-gpl|--enable-nonfree" <<<"$version"; then
  echo "Build ist nicht LGPL" >&2
  exit 1
fi
{
  echo "Quelle: $url"
  echo "SHA-256: $(cut -d' ' -f1 "$work/sha256.txt")"
  echo
  echo "$version"
} > "$out/BUILD.txt"
echo "ffmpeg/ffprobe (LGPL) → $out"
