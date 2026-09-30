# Predicting camping zones from coarse data (idea, for later)

Status: idea, not started. Written 2026-09-30.

## The problem

The camping finder needs about 2 m terrain to see a pitch (a flat, smooth patch of about 3 x 3 m). Many countries only offer coarse data that a browser can read: Copernicus DEM at 30 m worldwide, Spain at 5 m in whole metres, Austria's photogrammetric DGM (measured on a 50 m grid). See `docs/DATA-EUROPE.md`.

Coarse data cannot find pitches: a pitch is far smaller than one 30 m cell, and Copernicus is a surface model that includes forest tops. But it still carries a lot of signal for **zones**: wide flat basins, alp pastures, valley floors and benches wider than about 30 m show up; land cover separates grass from forest, scree and rock; OSM gives trails and water. The question is how much of the fine-scale answer can be predicted from that.

## The idea

Learn the mapping from coarse inputs to fine-scale pitch availability where we know the answer, and apply it where we do not.

- **Labels are free.** Run the existing 2 m analysis (`pitchSuitability` + `patchMinimum`, default settings, lakes excluded) over all of Switzerland and aggregate to the coarse grid: per 30 m cell, the share of ground (or the count of 6 x 6 m patches) that fits a tent. That is millions of labelled cells without any manual work.
- **More truth outside Switzerland.** The survey found browser-readable 0.5-1 m terrain in France, the Netherlands, Flanders, Luxembourg, England, Scotland, Norway, Czechia, Estonia, Tyrol, South Tyrol and parts of Germany. Labels from several of them give the model varied terrain (Alps, Scandinavia, lowlands, Mediterranean edges) and, more importantly, an honest test.
- **Inputs, all available worldwide:**
  - Copernicus DEM 30 m: slope, curvature, local relief, position on the slope (valley floor, bench, ridge), aspect, elevation.
  - ESA WorldCover 10 m: tree cover, shrubland, grassland, bare or sparse (scree, rock), snow and ice, wetland, water.
  - Sentinel-2 imagery at 10 m (cloud-free summer composite): texture tells meadow from boulder fields and shows paths.
  - OSM: distance to trails and water, land use.
  - Optionally a canopy height model at 10 m (for example the ETH global canopy height map) where WorldCover is too coarse.
- **Output:** per coarse cell, the predicted share of pitchable ground, shown as "likely zones (coarse prediction)" in a visually distinct style, never as pitches, and never with the "best spots" markers.

## How to go about it

1. **Labels and a baseline (a few days).** Generate Swiss labels at 30 m. Baseline: a hand-made rule on the coarse inputs (slope under a threshold, grass or bare land cover, not water). Measure how well it ranks cells against the 2 m truth.
2. **A gradient-boosted model on per-cell features.** Cheap, explainable, strong on tabular features. This is the model to beat.
3. **A small CNN (a U-Net over patches of the input stack)** only if it clearly beats step 2. Its advantage is spatial context: a flat bench on a slope, a meadow in a forest clearing, a basin behind a moraine.
4. **Evaluate on countries the model never saw** (for example train on Switzerland and France, test on Norway and Scotland). Domain shift from the Alps to other landscapes is the main risk; a single random split inside Switzerland would overstate the quality.
   - Metrics: how many of the truly pitch-rich cells are in the top 5 % of predictions (recall at k), how often a top-ranked cell really has pitches (precision at k), and area under the precision-recall curve.

## Deployment

Compute the predictions offline and publish them as a static probability raster (Cloud-Optimized GeoTIFF, uint8, 30 m), read by the app with the existing COG reader. No model runs in the browser, so there is no new dependency and nothing heavy on phones. CLAUDE.md allows offline precomputation served as static files. Europe at 30 m in uint8 is a few gigabytes after compression; a free or very cheap object store (for example Cloudflare R2) is enough. Countries with fine data keep the real 2 m analysis; the prediction only fills the gaps.

## What to expect

Useful for "where should I look" in countries without fine data, probably clearly better than a slope threshold on 30 m, but not a replacement for pitch detection. Whether it is worth building depends on step 1 and 2: if the simple models already rank zones well, the CNN may add little.
