# Tracer logo kit

The Tracer mark is a T drawn in call audio bars, echoing the Recording waveform on Call Detail. The wordmark is Instrument Sans Semibold with the app's tight tracking, converted to outlines so no file depends on an installed font.

`BrandMark` in `components/tracer/brand.tsx` draws the five-bar symbol from the geometry below, and `app/icon.png` is `web/icon-512.png`. The PDF report cover does not use the mark yet.

## Files

| File | Use |
| --- | --- |
| `tracer-horizontal.svg` | Primary lockup: sign-in, report covers, email |
| `tracer-stacked.svg` | Square or narrow spaces |
| `tracer-symbol.svg` | Symbol alone, 24px and larger |
| `tracer-symbol-small.svg` | Three-bar cut for anything under 24px, and the favicon |
| `tracer-wordmark.svg` | Wordmark alone |
| `tracer-symbol-accent.svg` | App tile with the centre bar in Brand orange, dark ground only |
| `tracer-symbol-app-icon.svg` | App tile in one colour |
| `*-black.svg`, `*-white.svg` | One-colour versions for light and dark grounds |
| `tracer-horizontal-*-1200.png` | Raster lockups for tools that cannot take SVG |
| `web/` | `favicon.ico`, PNG icons, `site.webmanifest`, and `head-snippet.html` |

## Construction

- Symbol canvas is 256 by 256. Five bars, each 32 wide and 12 apart, share one top edge at y 36 and one 6-unit corner radius.
- Bar heights are 52, 76, 184, 76, 52. The long centre bar is the stem of the T.
- The small cut uses three bars, each 56 wide and 20 apart, with heights 72, 184, 72.
- In the horizontal lockup the symbol is 1.22 times the cap height of the wordmark and is centred on it.

## Colour

| Role | Value |
| --- | --- |
| Ink, light grounds | `#09090a` (zinc-950) |
| Reversed, dark grounds | `#fafafa` (zinc-50) |
| Accent, centre bar only | `#f79d71` (Brand orange) |

The logo is one colour by default and should follow the foreground colour of the theme it sits on. The orange centre bar is optional and only for dark grounds, where it has enough contrast. `DESIGN.md` currently reserves Brand orange for the key chart series, so using the accent version in the app needs that rule changed first.

## Rules

- Clear space on every side is the width of two bars.
- Minimum width is 96px for the horizontal lockup and 24px for the five-bar symbol. Below 24px use the three-bar cut.
- Do not recolour single bars other than the centre bar, change bar heights, add effects, or retype the wordmark in a live font.
- Use at most one mark per view, and never behind data.

## Open items

- No trademark search has been done.
- The wordmark kerning comes from the font's Regular master with Semibold advances; it has been checked by eye, not against a design tool.
