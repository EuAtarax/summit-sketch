# Changelog

Newest first. Each entry says what changed for the user and where in the code.

## 2026-10-01: Austria, France, and a phone-friendly panel

- **Austria and France.** A tap finds the country first (geo.admin.ch in Switzerland, Nominatim elsewhere, throttled to one request per second and cached), then analyses with that country's data. Switzerland and Liechtenstein: swisstopo, as before. Austria: the BEV's 1 m laser-scan terrain and surface models through our Cloudflare proxy (`proxy/`). France: IGN's RGE ALTI and MNS. Places without data say which countries are covered. Code: `countries.ts`, `sources/`, `rules/index.ts` (`lookupPlace`), `main.ts`.
- **A grid per country.** Geometries carry their CRS; Austria and France use ETRS89-LAEA Europe (EPSG:3035, `crs.ts`), Switzerland keeps LV95.
- **GeoTIFF reader** for other countries' files (`tiff.ts`): BigTIFF, overviews, strips, Deflate, the floating-point predictor, float64 and 16-bit integers. Austria is read at its 2 m overview for terrain and 1 m for vegetation (`resample.ts`).
- **EU protected areas** outside Switzerland (`eea.ts`): Natura 2000 sites are listed, strictly protected and IUCN Ia/Ib areas hide ground.
- **Maps.** The first view shows all of Switzerland. Base maps stack national maps over maps that cover everywhere: OpenTopoMap with swisstopo (from zoom 10, so no white ring around Switzerland when zoomed out), Sentinel-2 with IGN, basemap.at and swissimage aerial images. New overlay: hiking routes everywhere (Waymarked Trails). The terrain credit follows the country (`baseMap.ts`, `overlays.ts`).
- **Quieter spots.** With the trail slider on "+", ground right next to a path scores lower, rising to full score 60 m away; before, everything within the chosen distance scored the same, so the best spots were often 10-30 m from a trail (`scoring.ts`, `trailQuietFactor`).
- **Phones: a low options sheet.** The panel is a bottom sheet of at most 42 % of the screen, the title is hidden, the tabs stay pinned, opacity and area size share a row, explanations show one line until tapped, and opening the sheet moves the map so the chosen spot stays visible above it (`camping.css`, `dom.ts`, `main.ts`).

## 2026-09-30: review fixes, speed, rules database

- **Protected areas:** nature parks and moorland landscapes no longer hide ground (they are huge and have no camping rule of their own); the strictest area wins where areas overlap; every protection period of an area is read; every area at a point is named.
- **Distances** to trails, water and drinking water count features just outside the box.
- **Speed:** scoring and painting run in the analysis worker (a slider move no longer blocks the page), terrain tiles are cached by the service worker, the worker's memory is bounded, and failed downloads are retried.
- **Accuracy:** vegetation height keeps small trees (second-highest of the surface pixels, measured against interpolated ground); lakes mapped in OpenStreetMap are ruled out, not only perfectly flat surfaces.
- **Settings:** one slope setting (comfortable slope; ground is ruled out at twice that), magma as the default heatmap colours, share links carry area size and layer.
- **Progress:** a pill under the chosen spot says what the analysis is doing, and the box outline moves while loading.
- **Camping rules database** (`rules/`): every canton, every Bundesland and the communes known to have their own bans, with sources and how well each entry is checked.
- **Docs:** which European countries have browser-readable terrain (`DATA-EUROPE.md`, re-check with `scripts/probe-elevation.mjs`) and an idea for predicting camping zones from coarse data (`COARSE-PREDICTION.md`).
- **Proxy** for Austria's data: `proxy/` (Cloudflare Worker), deployed as `camp-spots.shitlas-trash.workers.dev`.
