#!/usr/bin/env bash
# Baut ffmpeg/ffprobe als LGPL-Fassung aus den offiziellen Quellen (macOS).
# Nur eingebaute Codecs plus Apples VideoToolbox/AudioToolbox; keine GPL-Teile,
# keine Bibliotheken aus Homebrew (--disable-autodetect).
#
#   scripts/build-ffmpeg-macos.sh <release-linie, z. B. 8.1> <zielordner>
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
