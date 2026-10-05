# Third-party software and references

img2string is GPL-3.0-or-later. It bundles or builds with the following, all under licenses compatible with it.

| Component | Used for | License |
|---|---|---|
| [pdf-lib](https://pdf-lib.js.org/) 1.17.1 | the PDF downloads (nail template, winding instructions) | MIT |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) 1.1.1 | embedding the PDF font | MIT |
| [fflate](https://github.com/101arrowz/fflate) 0.8.3 | compressing the preview PNG | MIT |
| [Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC) (subset, weight 400) | the text in the PDFs | SIL Open Font License 1.1, see `src/assets/fonts/OFL.txt` |

pdf-lib and fontkit bring their own dependencies into the export worker: pako (MIT and Zlib),
@pdf-lib/standard-fonts (MIT), @pdf-lib/upng (MIT) and tslib (0BSD). All three libraries are pinned to an exact
version; pdf-lib is no longer maintained upstream, so only `src/export/pdfKit.ts` talks to it.

The font, `src/assets/fonts/NotoSansTC-Regular-subset.ttf`, is cut by `scripts/subset_font.py` from the
variable font in [google/fonts](https://github.com/google/fonts/tree/main/ofl/notosanstc): fixed at weight 400,
reduced to ASCII, the characters of both translation files, a few symbols and the words people name thread
colours with, and without its layout tables (GSUB, GPOS, GDEF). It keeps its copyright and licence in its name
table and is not named after the reserved font name. Run `npm run font:subset` after changing a translation
file; a test fails when a character of either language has no glyph.

Development only (not shipped): TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), Playwright (Apache-2.0),
fontTools (MIT, for `scripts/subset_font.py`).

Code ported from img2fold and img2shadow (same author, GPL-3.0-or-later): the project scaffold, the CSP build
plugin, the i18n helper and its tests (originally from
[line2func](https://github.com/far9100/Line-to-function)), the store, the image input handling, the DOM helpers
and toast, the drawing primitives with their canvas, SVG and PDF back ends, the PNG encoder, the PDF helper,
page tiling with its alignment marks, the text flow of the instruction sheet and the font subsetting script.

The string-art core (`src/core/stringart.ts`) and the two benchmark targets in `src/core/targets.ts` are the
reference implementation given in the specification (§12, §13.2), unchanged.

The DXF template is written in the R12 dialect described in Autodesk's DXF reference.

## References

- M. Birsak, F. Rist, P. Wonka, P. Musialski. *String Art: Towards Computational Fabrication of String
  Images.* Computer Graphics Forum 37(2):263–274 (Eurographics 2018). doi:10.1111/cgf.13359.
  Code: <https://github.com/birsakm/StringArt>
- P. Vrellis. *A New Way to Knit* (2016). <http://artof01.com/vrellis/works/knit.html>
- D. Varga. *string-art* (repository created in 2016). <https://github.com/danielvarga/string-art>
- C. Hierholzer, C. Wiener. *Ueber die Möglichkeit, einen Linienzug ohne Wiederholung und ohne Unterbrechung
  zu umfahren.* Mathematische Annalen 6 (1873).
- X. Wu. *An Efficient Antialiasing Technique.* SIGGRAPH 1991.
- B. Ottosson. *A perceptual color space for image processing* (OKLab), 2020.
  <https://bottosson.github.io/posts/oklab/>
