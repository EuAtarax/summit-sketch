# Terrain and map data for the camping finder in Europe

Survey of 2026-09-30. Question: for which European countries can the camping finder get the data it needs **from the browser, for free, without an API key or account**, the way it uses swisstopo in Switzerland? Every "verified" entry below was checked by downloading real data with a cross-origin request (an `Origin` header, like a page on GitHub Pages sends) and reading the TIFF header of the answer. `scripts/probe-elevation.mjs` repeats those checks; run it before building on an entry, because services change.

## What the finder needs

| Layer | Used for | Needed? | Minimum |
|---|---|---|---|
| Bare-earth terrain model (DTM) | slope, roughness, lakes, the whole pitch model | yes | about 2 m cells, float values (whole metres cannot resolve a 3 x 3 m pitch: a 1 m step over 5 m is 11 degrees) |
| Surface model (DSM) or canopy height | vegetation height (surface minus terrain) | optional | same grid as the DTM, or coarser |
| Trails, water, drinking water | distances | yes | OpenStreetMap via Overpass: already worldwide |
| Protected areas and their rules | flags, hiding ground | yes | polygons with a type; the rules are national or regional law |
| Base map | display | yes | any tile source; tiles shown as images need no CORS, so this never blocks a country |

A source is **usable** when all of these hold: it answers a cross-origin request with `Access-Control-Allow-Origin`, needs no key, token or login (CLAUDE.md: no API keys), returns raw float elevations (not a rendered picture), and is served over HTTPS.

## Summary

- **Usable today, country-wide:** France, Netherlands, Flanders (Belgium), Luxembourg, England, Norway, Czechia, Estonia, Switzerland and Liechtenstein (swissALTI3D covers Liechtenstein).
- **Usable for part of a country:** Germany (North Rhine-Westphalia, Baden-Wuerttemberg, Brandenburg), Austria (Tyrol), Italy (South Tyrol), Scotland (the areas the Scottish LiDAR phases flew).
- **The data is open, but a browser cannot read it:** Austria national, Bavaria, Poland, Wales, Slovenia, Iceland (no CORS header), Denmark and Finland (free token or key), Sweden and Portugal (account needed). One email asking the provider to add a CORS header would unblock the first group; the second group conflicts with the no-key rule unless the rule changes.
- **Too coarse or not found:** Spain (5 m in whole metres through the service), Italy nationally (20 m), Wallonia and Ireland (pictures only through services), and no open national fine DTM was found for Hungary, Croatia, Slovakia, the Baltic states other than Estonia, Romania, Bulgaria, Greece and the Western Balkans.
- **Europe-wide layers that work everywhere:** Copernicus DEM 30 m and ESA WorldCover 10 m land cover (Microsoft Planetary Computer, anonymous token), and protected areas (EEA Natura 2000, nationally designated areas, Emerald network). The 30 m DEM is a fallback for coarse zones only; it cannot find pitches.

## Countries

Status: **OK** usable (verified), **partial** usable for part of the country, **blocked** open data that a browser cannot read, **coarse** readable but too coarse, **none found** nothing suitable found (not proven absent). "Format" is what a request returns and decides the reader work (see below).

| Country | Status | Terrain source | Cell | Access | Format | Surface model | Notes |
|---|---|---|---|---|---|---|---|
| Switzerland | OK (in use) | swisstopo swissALTI3D | 0.5 / 2 m | 1 km COG files via STAC | float32, LZW, tiled | swissSURFACE3D 0.5 m | Open government data. |
| Liechtenstein | OK | swissALTI3D covers it | 2 m | as Switzerland | as Switzerland | as Switzerland | Checked in STAC (tiles 2760-1224/1225). |
| France | OK | IGN Geoplateforme, RGE ALTI (`ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES`) | 1 m | WMS-R GetMap, `image/geotiff` or `image/x-bil;bits=32`, any bbox, no key | float32, uncompressed | yes: `...HIGHRES.MNS` layer | `data.geopf.fr/wms-r`. |
| Netherlands | OK | PDOK AHN WCS `dtm_05m` | 0.5 m | WCS 2.0.1 GetCoverage, RD New (EPSG:28992) | float32, **Deflate with floating-point predictor** | yes: `dsm_05m` (checked) | `service.pdok.nl/rws/ahn/wcs/v1_0`. |
| Belgium, Flanders | OK | DHMV II WCS `DHMVII_DTM_1m` | 1 m | WCS 1.0.0 (2.0.1 answers multipart), Lambert 72 (EPSG:31370) | float32, uncompressed | yes: `DHMVII_DSM_1m` | `geo.api.vlaanderen.be/DHMV/wcs`. |
| Belgium, Wallonia | blocked | SPW `RELIEF/WALLONIE_MNT_2021_2022` | 1 m (per SPW) | ArcGIS MapServer with WMS only: rendered images | picture | picture | Downloads exist; no value service found. |
| Luxembourg | OK | ACT LiDAR 2024 DTM, one COG for the country | 0.5 m | range requests on one 40 GB file | **BigTIFF, float64**, LZW, 128 px tiles | DSM published too (not checked) | Link redirects from data.public.lu to `download.data.public.lu/.../MNT_Lidar2024.tif`. |
| Germany, North Rhine-Westphalia | partial (OK) | Geobasis NRW DGM1 files | 1 m | 1 km GeoTIFF files, index in `index.json`, range requests | float32, LZW, **strips, not tiles**, not a COG | DOM files exist (not checked) | `opengeodata.nrw.de`. Node's fetch timed out on 2026-09-30 while curl and an earlier Node run worked. |
| Germany, Baden-Wuerttemberg | partial (OK) | LGL WCS `EL.ElevationGridCoverage` | 1 m | WCS 2.0.1, ETRS89/UTM 32 (EPSG:25832) | float32, uncompressed | not checked | `owsproxy.lgl-bw.de/owsproxy/wcs/WCS_INSP_BW_Hoehe_Coverage_DGM1`. No-data is 0. |
| Germany, Brandenburg | partial (OK) | LGB WCS `bb_dgm` | 1 m | WCS 2.0.1, UTM 33 (EPSG:25833) | float32, uncompressed | not checked | `isk.geobasis-bb.de/ows/dgm_wcs`. |
| Germany, Bavaria | blocked | LDBV DGM1 1 km files | 1 m | range requests work, **no CORS** | float32, not a COG | DOM exists | Metalink lists per municipality: `geodaten.bayern.de/odd/a/dgm/dgm1/meta/metalink/<AGS>.meta4`. |
| Germany, other states | none found | - | - | Thuringia's service is hillshade only; guessed WCS URLs for Saxony, Lower Saxony, Hesse, Rhineland-Palatinate and Saxony-Anhalt failed (403/400/404) | - | - | Most states publish DGM1 as open data; their services still need finding. |
| Austria, national | blocked | BEV ALS DTM, 55 tiles of 50 km | 1 m | COG-style BigTIFF, range requests work, **no `Access-Control-Allow-Origin`** | float32, LZW, 256 px tiles | ALS DSM (same layout) | `data.bev.gv.at/download/ALS/DTM/<date>/ALS_DTM_CRS3035RES50000mN...E....tif`. The most valuable one to ask for CORS: it would cover all of Austria. |
| Austria, Tyrol | partial (OK) | Land Tirol WCS `Gelaendemodell_50cm_M28` / `_M31` | 0.5 m | WCS 1.0.0, **reprojects on request (asked in EPSG:4326)** | float32, uncompressed | yes: `Oberflaechenmodell_50cm_*` | `gis.tirol.gv.at/arcgis/services/Service_Public/terrain/MapServer/WCSServer`. Also offers slope layers. |
| Austria, other states | none found | - | - | Carinthia has a WCS (capabilities request answered 400 with CORS); others not checked | - | - | |
| Italy, South Tyrol | partial (OK) | Provincia di Bolzano WCS `p_bz-Elevation__DigitalTerrainModel-2.5m` | 2.5 m (0.5 m in settled areas) | WCS 2.0.1, GeoServer, accepts `subsettingCrs` EPSG:4326 | float32, uncompressed | yes: `...DigitalElevationModel-2.5m` / `-0.5m` | `geoservices9.civis.bz.it/geoserver/ows`. 2.5 m is coarse but workable with a 1-cell patch. |
| Italy, national | coarse | Geoportale Nazionale WCS `dtm_20m` | 20 m | WCS, **http only** (an https page cannot load it) | - | - | LiDAR 1 m exists for parts (e.g. Sardinia) as downloads or WMS pictures; Trentino publishes ASC/LAZ downloads; other regions not checked. |
| Spain | coarse | IGN/CNIG WCS `Elevacion4258_5` (MDT05) | 5 m | WCS 2.0.1, CORS ok | **int16: whole metres** | - | `servicios.idee.es/wcs-inspire/mdt`. The 2 m LiDAR models are downloads from CNIG only. |
| Portugal | blocked | DGT LiDAR MDT | 0.5 / 2 m | CDD platform, **login required** (free registration) | GeoTIFF | MDS 0.5 m | `cdd.dgterritorio.gov.pt`. |
| United Kingdom, England | OK | Environment Agency LiDAR composite DTM | 1 m | WCS 2.0.1, British National Grid (EPSG:27700) | float32, uncompressed | yes: composite DSM WCS (checked) | `environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs`. OGL. |
| United Kingdom, Scotland | partial (OK) | Scottish Remote Sensing Portal, LiDAR phases 1-6 | 0.5-1 m | COGs on S3 (`srsp-open-data`), 5 km tiles, list with `?list-type=2&prefix=lidar/` | float32, LZW, 256 px tiles, overviews: **what the app already reads** | DSM COGs too | Coverage is only what each phase flew. OGL. |
| United Kingdom, Wales | blocked | Welsh Government LiDAR 2020-22 | 1 m | 1 km files on Azure blob storage, **no CORS** | float32, Deflate | DSM too | Tile links from the WFS layer `geonode:welsh_government_lidar_tile_catalogue_2020_2023` on `datamap.gov.wales`. |
| United Kingdom, Northern Ireland | none found | OSNI river-basin LiDAR (2004, 2014) | - | partial downloads | - | - | Not checked. |
| Ireland | blocked | GSI open topographic LiDAR | 1-2 m | ArcGIS ImageServers serve **8-bit hillshade only**; data are downloads | picture | - | `gsi.geodata.gov.ie/imagehost/rest/services/Lidar`. Partial coverage. |
| Norway | OK | Kartverket NHM DTM WCS `nhm_dtm_topo_25833` | 1 m | **WCS 1.0.0** (2.0.1 GetCoverage failed), UTM 33 | float32, uncompressed | yes: `wcs.hoyde-dom-nhm-25833` (checked) | `wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833`. |
| Sweden | blocked | Lantmaeteriet Markhoejdmodell grid 1+ | 1 m | STAC API, **order and credentials via Geotorget** | - | - | Open data, but not anonymous. |
| Finland | blocked | NLS elevation model 2 m | 2 m | WCS/OGC API needs a free **API key** (401 without) | - | - | A public mirror (`mirrors.nic.funet.fi/index/geodata/mml/dem2m/`) has the files but no CORS. |
| Denmark | blocked | Dataforsyningen DHM | 0.4 m | WCS needs a free **token** (403 without) | - | yes | Would be excellent if the no-key rule allowed a public token. |
| Iceland | blocked | IslandsDEM | 2 m | one 4.9 GB BigTIFF, range requests work, **no CORS** | float32 | - | `ftp.lmi.is/stm/michaela/IslandsDEMv1/`. |
| Estonia | OK | Maa- ja Ruumiamet WCS `dtm-1` | 1 m | WCS 2.0.1, axis order y, x (EPSG:3301) | float32, uncompressed | DSM 1 m and canopy height published (service not checked) | `teenus.maaamet.ee/ows/wcs-dtm`. |
| Latvia, Lithuania | none found | LiDAR point clouds (LAS) | - | downloads | - | - | No gridded service found. |
| Poland | blocked | GUGiK NMT WCS | 1 m | WCS 2.0.1 works (axis order y, x, EPSG:2180), **no CORS** | float32 | NMPT exists | `mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF`. |
| Czechia | OK | CUZK DMR 5G ImageServer | 2 m | ArcGIS `exportImage`, `pixelType=F32`, `format=tiff`, bbox in any SR (asked in EPSG:4326) | float32, uncompressed | yes: `dmp1g` ImageServer (CORS checked) | `ags.cuzk.cz/arcgis2/rest/services/dmr5g/ImageServer`. |
| Slovakia | none found | UGKK DMR 5.0 | 1 m | open data per UGKK; no value service found | - | - | |
| Slovenia | blocked | ARSO LiDAR DMR1 | 1 m | 1 km **text files** (x;y;z), HTTPS, range requests, **no CORS** | text | - | `gis.arso.gov.si/lidar/dmr1/b_<block>/D96TM/TM1_<x>_<y>.txt`. |
| Croatia | blocked | DGU DMR (LiDAR 2020-23) | - | WMS after registration | picture | - | |
| Hungary | none found | Lechner | 5 m and coarser | not open as far as found | - | - | |
| Romania, Bulgaria, Greece, Serbia, Bosnia and Herzegovina, Montenegro, Albania, North Macedonia, Kosovo, Moldova | none found | - | - | North Macedonia's LiDAR is sold, not open | - | - | Fall back to the Europe-wide layers. |
| Andorra, Monaco, San Marino, Malta, Cyprus | not checked | - | - | - | - | - | |

## Europe-wide layers (verified)

| Layer | Source | Access | Notes |
|---|---|---|---|
| Terrain, coarse | Copernicus DEM GLO-30 | Microsoft Planetary Computer: anonymous SAS token from `planetarycomputer.microsoft.com/api/sas/v1/token/elevationeuwest/copernicus-dem`, then range requests on the COG (`elevationeuwest.blob.core.windows.net/copernicus-dem/COP30_hh/...tif?<token>`); STAC at `planetarycomputer.microsoft.com/api/stac/v1` | CORS on all three. 30 m and a **surface** model (forest tops): marks coarse zones, never pitches. The same files on AWS (`copernicus-dem-30m.s3.amazonaws.com`) send no CORS header. |
| Land cover | ESA WorldCover 10 m (2021) | Planetary Computer, token from `.../token/esa-worldcover`, COG range requests | CORS. Classes for tree cover, shrubland, grassland, bare/sparse (rock, scree), snow and ice, wetland and water: a vegetation and rock fallback where no surface model exists. The AWS copy has no CORS. |
| Protected areas | EEA Natura 2000 (`bio.discomap.eea.europa.eu/arcgis/rest/services/ProtectedSites/Natura2000Sites/MapServer`, layers 0 habitats sites, 1 bird sites), nationally designated areas (`.../ProtectedSites/NatDAv24_Dyna_WM`), Emerald network (`.../ProtectedSites/EmeraldSites`, includes Switzerland, Norway and the Balkans) | ArcGIS `query` with an envelope, CORS | EU member states plus Emerald countries. Gives type and name, not the camping rule. OSM `boundary=protected_area` via Overpass is the worldwide fallback. |
| Trails, water, drinking water | OpenStreetMap via Overpass | as today | Worldwide. |
| Base maps | OpenStreetMap, OpenTopoMap; national topographic tiles where open (IGN Plan/SCAN via Geoplateforme WMTS, Kartverket, basemap.at, ...) | image tiles | Tiles shown as `<img>` need no CORS. |

Not usable: the WDPA (Protected Planet) needs an API token and restricts reuse; Meta's 1 m global canopy height (`dataforgood-fb-data` on AWS) sends no CORS header.

## What this means for the code

- **Provider interface first.** The pipeline, raster and heatmap code assume LV95. A provider needs to answer "give me the DTM (and optionally the DSM) for this box as a float grid in a metric CRS, plus its geometry". The analysis itself (slope, roughness, lakes, distances, scoring) works on any metric grid. The overlay already maps pixels to cells through a projection, so each provider brings its CRS conversion (UTM for most countries; national grids for NL, BE, UK, PL, EE, CZ).
- **Three access patterns cover every usable source:**
  1. *Files with range requests* (CH, LU, Scotland, NRW; AT national and Bavaria if they add CORS): the existing COG reader. Needed additions: BigTIFF and float64 (LU), strips as well as tiles (NRW), Deflate through the browser's `DecompressionStream` and the floating-point predictor (NL, Wales).
  2. *WCS GetCoverage* (NL, Flanders, England, Norway, Estonia, BW, Brandenburg, Tyrol, South Tyrol): one request per box that returns a small uncompressed GeoTIFF, and the server clips it. Tyrol and South Tyrol even reproject. Mind the per-service quirks noted in the table: WCS version, axis order, the name of the subset axes, multipart answers.
  3. *ArcGIS `exportImage` or WMS-R GetMap* (Czechia, France): like WCS with a bbox and a pixel size.
- **Cap request sizes.** WCS servers limit the size of one answer; a 4 x 4 km box at 1 m is 16 M cells (64 MB of float32), so ask in tiles (for example 1000 x 1000) and at 2 m where the service can resample.
- **Resolution varies (0.5 to 2.5 m).** The analysis should resample to 2 m or take the cell size as a parameter; the roughness window and the patch radius are defined in cells today.

## Legal context (not map data, but needed per country)

Wild camping rules are national or regional law, and the app must never say a spot is allowed. From general knowledge, **to be verified before any of it is shown**: the Nordic countries have a right of public access that includes a night's camping away from houses (Norway, Sweden, Finland); Scotland's access rights include wild camping, with byelaw zones around Loch Lomond; England and Wales generally need the landowner's permission (Dartmoor commons are the known exception); in Austria, Germany, France, Italy and Switzerland the rules differ by state, region or canton, and forests, nature reserves and national park cores are commonly restricted. Each new country needs its own short, sourced rules note.

## Re-running the checks

`node --use-system-ca scripts/probe-elevation.mjs [filter]` prints one line per source: `OK` (a browser can read float elevations), `INTEGER` (readable but whole units), `BLOCKED` (no CORS, a key, or an error) or `FAILED` (no connection). `--use-system-ca` makes Node trust the same certificates as a browser; several national servers fail certificate checks without it on Windows.

## Sources

- The services themselves (URLs in the tables), queried on 2026-09-30.
- [BEV ALS DTM metadata](https://data.bev.gv.at/geonetwork/srv/api/records/82218b81-ad14-45e9-a92f-ee5835d275d5/formatters/xml), [Land Tirol laser scan data](https://tirol.gv.at/sicherheit/geoinformation/geodaten-tiris/laserscandaten)
- [South Tyrol DTM 0.5 m metadata](https://geonetwork1.civis.bz.it/geonetwork/srv/api/records/p_bz:Elevation:DigitalTerrainModel-0.5m), [OpenDEM Europe, Italy](https://opendem.info/opendemeu_meta_italy.html)
- [Lantmaeteriet elevation model download](https://lantmateriet.se/en/geodata/geodata-products/product-list/elevation-model-download), [Markhoejdmodell STAC guide](https://www.lantmateriet.se/contentassets/6b85c93c6954407e855c896da5a415f2/guide_radiant_earth_markhojdmodell.pdf)
- [Scottish LiDAR on the AWS open data registry](https://registry.opendata.aws/scottish-lidar), [Welsh LiDAR tile catalogue](https://datamap.gov.wales/layers/geonode:welsh_government_lidar_tile_catalogue_2020_2023)
- [Estonian elevation data](https://geoportaal.maaamet.ee/eng/Spatial-Data/Elevation-Data-p308.html), [Luxembourg DTM 2024](https://data.public.lu/en/datasets/inspire-annex-ii-theme-elevation-elevationgridcoverage-dtm-2024/)
- [Ireland open topographic LiDAR](https://data.gov.ie/en_GB/dataset/open-topographic-lidar-data), [Portugal LiDAR tutorial (CDD registration)](https://www.generic-mapping-tools.org/GMTjl_doc/tutorials/dgt_lidar/tut_dgt_lidar.html)
- [Slovenian LiDAR tutorial (ARSO URLs)](https://paleoseismicity.org/tutorial-how-to-make-a-dem-from-the-slovenian-lidar-data/), [Iceland IslandsDEM](https://ftp.lmi.is/stm/michaela/IslandsDEMv1/)
- [Croatian LiDAR programme](https://resource.geospatialworld.net/casestudy/strengthening-disaster-risk-reduction-through-official-geospatial-data-and-multisensor-aerial-imaging-in-croatia), [North Macedonia DEMs](https://www.gim-international.com/content/news/new-digital-elevation-models-in-north-macedonia), [JRC overview of open LiDAR data](https://publications.jrc.ec.europa.eu/repository/bitstream/JRC126223/jrc126223_jrc126223_lidaropensourcedata.pdf)
