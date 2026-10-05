"""Builds the PDF font (run with `npm run font:subset` after changing the i18n files).

src/assets/fonts/NotoSansTC-Regular-subset.ttf: Noto Sans TC fixed at weight 400 and cut down to the
characters of both i18n files plus ASCII, the symbols the PDFs print, and the words people name threads
with. The PDFs embed it with pdf-lib's subset:false, because pdf-lib's own subsetting is broken for CJK
fonts. Ported from img2fold (originally img2shadow, same author).

The full variable font (google/fonts, OFL-1.1, about 12 MB) is downloaded once into scripts/.cache/.
This file is plain ASCII: Chinese text lives only in src/i18n/zh-TW.json, so the extra characters are
written as escapes.
"""

import json
import urllib.request
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "scripts" / ".cache"
BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/"
VARIABLE = "NotoSansTC[wght].ttf"
FONT_OUT = ROOT / "src" / "assets" / "fonts" / "NotoSansTC-Regular-subset.ttf"
OFL_OUT = ROOT / "src" / "assets" / "fonts" / "OFL.txt"

# Symbols the PDFs may print beyond the translations: multiplication sign, plus-minus, degree, middle dot,
# dashes, ellipsis, less/greater-or-equal and the four arrows ...
SYMBOLS = "\u00d7\u00b1\u00b0\u00b7\u2013\u2014\u2026\u2264\u2265\u2192\u2190\u2191\u2193"
# ... and full-width punctuation: ( ) : , ideographic full stop and comma, ; % / + - = ~, the corner quotes
# and title marks, ! ? and the full-width full stop.
PUNCTUATION = (
    "\uff08\uff09\uff1a\uff0c\u3002\u3001\uff1b\uff05\uff0f\uff0b\uff0d\uff1d\uff5e\u300c\u300d\u300e"
    "\u300f\u300a\u300b\uff01\uff1f\uff0e"
)
# A thread's name is the user's own text, and the instruction sheet prints it only when the font has every
# character of it (otherwise it prints the colour code). These are the characters Traditional Chinese
# thread names are made of, so that most names print:
# colours (black, white, grey, red, orange, yellow, green, blue, indigo, purple, pink, brown, coffee, gold,
# silver, cyan, beige, skin, peach, ink, tea, khaki, magenta, vermilion, jade, apricot, milk, wine, earth,
# brick, copper, iron, gem, lake, water, sky, sea, navy, grass, apple, lemon, grape, olive, mint, rose,
# cherry blossom, coral, lavender, camel, ivory, mustard, smoke, charcoal, snow, night, neon, fluorescent,
# transparent, natural),
COLOURS = (
    "\u9ed1\u767d\u7070\u7d05\u6a59\u6a58\u9ec3\u7da0\u85cd\u975b\u7d2b\u7c89\u68d5\u8910\u5496\u5561"
    "\u91d1\u9280\u9752\u7c73\u819a\u6843\u58a8\u8336\u5361\u5176\u6d0b\u6731\u8d64\u78a7\u7fe0\u674f"
    "\u4e73\u5976\u9152\u571f\u78da\u9285\u9435\u5bf6\u77f3\u6e56\u6c34\u5929\u7a7a\u6d77\u8ecd\u8349"
    "\u860b\u679c\u6ab8\u6aac\u8461\u8404\u6a44\u6b16\u8584\u8377\u73ab\u7470\u6afb\u82b1\u73ca\u745a"
    "\u85b0\u8863\u99dd\u8c61\u7259\u82a5\u672b\u7159\u9727\u70ad\u96ea\u591c\u9713\u8679\u87a2\u5149"
    "\u900f\u660e\u539f\u672c"
)
# shades (deep, light, bright, dark, pale, strong, vivid, pure, true, large, medium, small, -ish, tinted),
SHADES = "\u6df1\u6dfa\u4eae\u6697\u6de1\u6fc3\u9bae\u7d14\u6b63\u5927\u4e2d\u5c0f\u504f\u5e36"
# thread words (colour, thread, number, ordinal, strand, fine, thick, cotton, embroidery, sewing, silk, hemp,
# wool, nylon, waxed, cord, nail, base, board, main, second, new, old, top, bottom, left, right, front,
# back, inner, outer, layer)
WORDS = (
    "\u8272\u7dda\u865f\u7b2c\u689d\u7d30\u7c97\u68c9\u7e61\u7e2b\u7d09\u7d72\u9ebb\u6bdb\u5c3c\u9f8d"
    "\u881f\u7e69\u91d8\u5e95\u677f\u4e3b\u526f\u65b0\u820a\u4e0a\u4e0b\u5de6\u53f3\u524d\u5f8c\u5167"
    "\u5916\u5c64"
)
# and the numerals one to ten, zero and hundred.
NUMERALS = "\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u96f6\u767e"
EXTRA = SYMBOLS + PUNCTUATION + COLOURS + SHADES + WORDS + NUMERALS


def fetch(name: str) -> Path:
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        url = BASE + urllib.request.quote(name)
        print(f"downloading {url}")
        with urllib.request.urlopen(url) as response:  # noqa: S310 (a fixed https URL)
            path.write_bytes(response.read())
    return path


def characters() -> str:
    chars = set(EXTRA)
    chars.update(chr(c) for c in range(0x20, 0x7F))
    for name in ("zh-TW.json", "en.json"):
        data = json.loads((ROOT / "src" / "i18n" / name).read_text(encoding="utf-8"))
        for value in data.values():
            texts = value.values() if isinstance(value, dict) else [value]
            for text in texts:
                chars.update(text)
    return "".join(sorted(chars))


def build_subset(source: Path, text: str) -> None:
    # recalcTimestamp=False: the same characters give the same bytes, so a rerun leaves no change to commit.
    # updateFontNames: the instance is named for its weight ("NotoSansTC-Regular"), not for the variable
    # font's default ("Thin"), which is the name a PDF viewer lists.
    font = instantiateVariableFont(TTFont(source, recalcTimestamp=False), {"wght": 400}, updateFontNames=True)
    options = Options()
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    # no OpenType layout: fontkit would otherwise apply GSUB substitutions whose widths pdf-lib then writes
    # wrongly; plain cmap glyphs are all the PDFs need
    options.layout_features = []
    options.drop_tables += ["GSUB", "GPOS", "GDEF"]
    subsetter = Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    FONT_OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(FONT_OUT)
    missing = [ch for ch in text if ord(ch) not in font.getBestCmap() and not ch.isspace()]
    print(f"{FONT_OUT.relative_to(ROOT)}: {FONT_OUT.stat().st_size} bytes, {len(text)} characters"
          + (f", no glyph for {ascii(''.join(missing))}" if missing else ""))


def main() -> int:
    source = fetch(VARIABLE)
    OFL_OUT.parent.mkdir(parents=True, exist_ok=True)
    OFL_OUT.write_bytes(fetch("OFL.txt").read_bytes())
    build_subset(source, characters())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
