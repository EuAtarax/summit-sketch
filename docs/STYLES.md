# Style specs

Every 2D style renders the same `PanoramaScene`. Each spec lists the look, the palette, and the technique.

## Shared techniques

- **Painter's fill:** sort ridgelines by distance, farthest first. Fill each one from its line down to the bottom of the canvas. Nearer ridges cover farther ones, which gives correct occlusion without any 3D. Taper the fragment ends slightly so they don't show hard vertical edges.
- **Depth bands:** bucket ridgelines on a log scale by distance, e.g. 0–5, 5–15, 15–40, 40–100, 100+ km. Most styles vary color, width, or opacity per band.
- **Snow:** where `elev > snowline(lat)`, draw a snow band just below the crest, with thickness proportional to the elevation above the snowline. Default `snowline(lat) = 5300 − 55·|lat|` meters. It's an artistic approximation, adjustable with a slider.
- **Seeded wobble:** offset line points with 1D noise (seeded, amplitude in px scaled by depth) for a hand-drawn feel.

## Styles

**1. Pencil sketch** (Phase 2)
- **Look:** graphite on off-white paper.
- **Technique:** strokes only. Near ridges get 2–3 overlapping wobbly strokes at 1.5–2.5 px and dark grey; far ridges get one faint, thin stroke. Add short diagonal hatching below near crests, with density fading with distance, and a subtle paper-grain texture generated procedurally.

**2. Misty layers** (Phase 2)
- **Look:** flat silhouettes that fade into the sky (atmospheric perspective).
- **Technique:** painter's fill. Each band's color interpolates from a dark foreground toward the sky color, with no outlines. Offer three palettes: Dawn (peach → violet), Day (blue-greys), and Dusk (orange → indigo).

**3. Cartoon** (Phase 2)
- **Look:** bold, friendly, and bright.
- **Technique:** painter's fill in flat saturated greens, blues and purples by depth, with a 3 px dark outline on the three nearest bands. Add white snow caps with a slightly scalloped lower edge, a gradient sky, and 3–5 seeded puffy clouds behind far ridges.

**4. Ink panorama** (Phase 6)
- **Look:** the classic summit panorama board.
- **Technique:** crisp black lines on white, no fill, with width stepping down by band. Designed to be used with labels, which get thin leader lines and names set in Barlow Condensed.

**5. Watercolor** (Phase 6)
- **Look:** soft washes of color.
- **Technique:** painter's fill with low-opacity layers. Draw each band 3–4 times with jittered edges and blur, add slight edge darkening (pigment pooling), and let the paper texture show through.

**6. Retro travel poster** (Phase 6)
- **Look:** a vintage printed poster.
- **Technique:** 3–4 flat colors from a limited palette, with a big sun disc or gradient bands in the sky and a grain overlay. Optionally show the summit name in a large condensed title at the bottom (export only).

**7. Blueprint** (Phase 6)
- **Look:** technical and nerdy.
- **Technique:** white lines on blueprint blue, with a visible azimuth/elevation grid labeled in degrees. Label mode shows distance and elevation.

**8. Synthwave** (Phase 6)
- **Look:** neon glow on a dark background.
- **Technique:** a dark gradient sky with a striped sun. Ridgelines are drawn as glowing strokes (a wide blurred stroke under a thin bright one), colored magenta → cyan by depth.

**9. Realistic** (Phase 7)
- A 3D render with three.js. See PLAN.md, Phase 7.

## Labels per style

Each style provides `labelStyle`: font, color, leader-line style, and background (none, a paper chip, or a glow). Labels must stay readable on all backgrounds.
