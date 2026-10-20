#!/bin/sh
# Rebuilds the bundled Noto Sans SC Han subsets, packages/app/public/fonts/notosanssc-han-{400,700}.woff2.
# Run from the repository root after an import adds Han characters; `npm run check:translations`
# names any the subset lacks.
#
# Usage: tools/translations/subset-han-font.sh <dir holding NotoSansSC-Regular.otf and NotoSansSC-Bold.otf>
# The fonts come from https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/18_NotoSansSC.zip.
# Needs uv (https://docs.astral.sh/uv/), which fetches fontTools and brotli.
#
# The subset keeps GB 2312 and every Big5 hanzi, CJK Symbols and Punctuation (U+3000-303F), the
# katakana middle dot U+30FB, Halfwidth and Fullwidth Forms (U+FF00-FFEF), and every Han-script code
# point (U+2E80-9FFF, U+F900-FAFF, U+20000-2FFFF) used by translations/**/*.json or the app catalogs.
# Hinting stays; the vertical metrics tables vhea, vmtx and VORG go.
set -eu

if [ $# -ne 1 ]; then
  echo "usage: $0 <dir with NotoSansSC-Regular.otf and NotoSansSC-Bold.otf>" >&2
  exit 2
fi
SRC=$1
OUT=packages/app/public/fonts
CATALOGS=packages/app/src/i18n/catalogs
for f in "$SRC/NotoSansSC-Regular.otf" "$SRC/NotoSansSC-Bold.otf"; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
done
[ -d translations ] && [ -d "$OUT" ] || { echo "run from the repository root" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

uv run --quiet --with fonttools --with brotli python -I - translations "$CATALOGS" > "$WORK/unicodes.txt" <<'PY'
import glob, json, sys

translations, catalogs = sys.argv[1], sys.argv[2]
HAN = ((0x2E80, 0x9FFF), (0xF900, 0xFAFF), (0x20000, 0x2FFFF))
# Code points kept whatever the text uses: CJK punctuation, the katakana middle dot, full-width forms.
FIXED = ((0x3000, 0x303F), (0x30FB, 0x30FB), (0xFF00, 0xFFEF))

def is_han(cp):
    return any(lo <= cp <= hi for lo, hi in HAN)

def encodes(ch, codec):
    try:
        ch.encode(codec)
        return True
    except UnicodeEncodeError:
        return False

points = set()
for lo, hi in FIXED:
    points.update(range(lo, hi + 1))
# Every hanzi of GB 2312 and of Big5 levels 1 and 2 lies in U+4E00-9FFF.
for cp in range(0x4E00, 0xA000):
    ch = chr(cp)
    if encodes(ch, 'gb2312') or encodes(ch, 'big5'):
        points.add(cp)

def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from strings(item)

texts = []
for path in sorted(glob.glob(f'{translations}/**/*.json', recursive=True)):
    with open(path, encoding='utf-8') as f:
        texts.extend(strings(json.load(f)))
for path in sorted(glob.glob(f'{catalogs}/*.ts')):
    with open(path, encoding='utf-8') as f:
        texts.append(f.read())
for text in texts:
    points.update(ord(ch) for ch in text if is_han(ord(ch)))

print(','.join(f'U+{cp:04X}' for cp in sorted(points)))
PY

subset() {
  uv run --quiet --with fonttools --with brotli pyftsubset "$1" \
    --unicodes-file="$WORK/unicodes.txt" \
    --flavor=woff2 \
    --hinting \
    --drop-tables+=vhea,vmtx,VORG \
    --output-file="$2"
}
subset "$SRC/NotoSansSC-Regular.otf" "$OUT/notosanssc-han-400.woff2"
subset "$SRC/NotoSansSC-Bold.otf" "$OUT/notosanssc-han-700.woff2"

uv run --quiet --with fonttools --with brotli python -I - "$OUT/notosanssc-han-400.woff2" "$OUT/notosanssc-han-700.woff2" <<'PY'
import os, sys
from fontTools.ttLib import TTFont

for path in sys.argv[1:]:
    font = TTFont(path)
    print(f'{path}: {len(font.getGlyphOrder())} glyphs, {len(font.getBestCmap())} code points, '
          f'{os.path.getsize(path)} bytes')
PY
