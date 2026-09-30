// Re-checks the European elevation sources listed in docs/DATA-EUROPE.md: can a browser page on
// another origin read real elevation values from them? For each source it sends the request a
// page would send (with an Origin header), and reports the HTTP status, the CORS header and, for
// a TIFF, its size, bit depth, sample format (3 = float), compression (1 none, 5 LZW, 8 Deflate)
// and tiling. Large files are read with a range request, as the app would.
//
//   node --use-system-ca scripts/probe-elevation.mjs [filter]
//
// (--use-system-ca makes Node trust the same certificates as the browser; some national servers
// fail without it.) The optional filter keeps only labels containing it, e.g. "DE-".

const SOURCES = [
  [
    'CH swissALTI3D 2 m (file)',
    'https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_2019_2721-1206/swissalti3d_2019_2721-1206_2_2056_5728.tif',
    true,
  ],
  [
    'FR IGN RGE ALTI 1 m (WMS-R)',
    'https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&CRS=EPSG:2154&BBOX=950000,6440000,950200,6440200&WIDTH=200&HEIGHT=200&FORMAT=image/geotiff&STYLES=',
  ],
  [
    'NL AHN DTM 0.5 m (WCS)',
    'https://service.pdok.nl/rws/ahn/wcs/v1_0?service=WCS&version=2.0.1&request=GetCoverage&coverageId=dtm_05m&subset=x(155000,155100)&subset=y(463000,463100)&format=image/tiff',
  ],
  [
    'BE-VL DHMV DTM 1 m (WCS)',
    'https://geo.api.vlaanderen.be/DHMV/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=DHMVII_DTM_1m&crs=EPSG:31370&bbox=150000,200000,150100,200100&width=100&height=100&format=GeoTIFF',
  ],
  [
    'LU DTM 2024 0.5 m (COG)',
    'https://download.data.public.lu/resources/bd-l-lidar2024-releve-3d-du-territoire-luxembourgeois/20241223-093912/MNT_Lidar2024.tif',
    true,
  ],
  [
    'UK-EN EA DTM 1 m (WCS)',
    'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs?service=WCS&version=2.0.1&request=GetCoverage&coverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m&subset=E(330000,330200)&subset=N(507000,507200)&format=image/tiff',
  ],
  [
    'UK-SC SRSP DTM 0.5 m (COG)',
    'https://srsp-open-data.s3.eu-west-2.amazonaws.com/lidar/phase-5/dtm/27700/gridded/NN70SE_50CM_DTM_PHASE5.tif',
    true,
  ],
  [
    'UK-WA DTM 1 m (file)',
    'https://dmwproductionblob.blob.core.windows.net/lidar-zips/2020-22/dtm/wg_del_1_222381_20200322dtm.tif',
    true,
  ],
  [
    'NO NHM DTM 1 m (WCS)',
    'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833?service=WCS&version=1.0.0&request=GetCoverage&coverage=nhm_dtm_topo_25833&crs=EPSG:25833&bbox=130000,6840000,130200,6840200&width=200&height=200&format=GeoTIFF',
  ],
  [
    'CZ DMR 5G (ImageServer)',
    'https://ags.cuzk.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage?bbox=15.60,50.70,15.61,50.71&bboxSR=4326&size=200,200&format=tiff&pixelType=F32&f=image',
  ],
  [
    'EE DTM 1 m (WCS)',
    'https://teenus.maaamet.ee/ows/wcs-dtm?service=WCS&version=2.0.1&request=GetCoverage&coverageId=dtm-1&subset=y(6500000,6500200)&subset=x(650000,650200)&format=image/tiff',
  ],
  [
    'DE-NW DGM1 (file)',
    'https://www.opengeodata.nrw.de/produkte/geobasis/hm/dgm1_tiff/dgm1_tiff/dgm1_32_280_5652_1_nw_2022.tif',
    true,
  ],
  [
    'DE-BW DGM1 (WCS)',
    'https://owsproxy.lgl-bw.de/owsproxy/wcs/WCS_INSP_BW_Hoehe_Coverage_DGM1?service=WCS&version=2.0.1&request=GetCoverage&coverageId=EL.ElevationGridCoverage&subset=E(421000,421200)&subset=N(5303000,5303200)&format=image/tiff',
  ],
  [
    'DE-BB DGM1 (WCS)',
    'https://isk.geobasis-bb.de/ows/dgm_wcs?service=WCS&version=2.0.1&request=GetCoverage&coverageId=bb_dgm&subset=x(400000,400200)&subset=y(5800000,5800200)&format=image/tiff',
  ],
  ['DE-BY DGM1 (file)', 'https://download1.bayernwolke.de/a/dgm/dgm1/683_5340.tif', true],
  [
    'AT BEV ALS DTM 1 m (file)',
    'https://data.bev.gv.at/download/ALS/DTM/20240915/ALS_DTM_CRS3035RES50000mN2600000E4400000.tif',
    true,
  ],
  [
    'AT-T Tirol DGM 0.5 m (WCS)',
    'https://gis.tirol.gv.at/arcgis/services/Service_Public/terrain/MapServer/WCSServer?service=WCS&version=1.0.0&request=GetCoverage&coverage=Gelaendemodell_50cm_M28&crs=EPSG:4326&bbox=11.39,47.26,11.392,47.262&width=200&height=200&format=GeoTIFF',
  ],
  [
    'IT-BZ DTM 2.5 m (WCS)',
    'https://geoservices9.civis.bz.it/geoserver/ows?service=WCS&version=2.0.1&request=GetCoverage&coverageId=p_bz-Elevation__DigitalTerrainModel-2.5m&subsettingCrs=http://www.opengis.net/def/crs/EPSG/0/4326&subset=Lat(46.54,46.545)&subset=Long(11.62,11.627)&format=image/tiff',
  ],
  [
    'ES IGN MDT 5 m (WCS)',
    'https://servicios.idee.es/wcs-inspire/mdt?service=WCS&version=2.0.1&request=GetCoverage&coverageId=Elevacion4258_5&subset=Lat(42.60,42.602)&subset=Long(0.50,0.503)&format=image/tiff',
  ],
  [
    'PL NMT 1 m (WCS)',
    'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF?service=WCS&version=2.0.1&request=GetCoverage&coverageId=DTM_PL-KRON86-NH_TIFF&subset=y(150000,150200)&subset=x(570000,570200)&format=image/tiff',
  ],
  [
    'SI ARSO DMR1 (XYZ text)',
    'https://gis.arso.gov.si/lidar/dmr1/b_22/D96TM/TM1_500_118.txt',
    true,
  ],
  [
    'IS IslandsDEM 2 m (file)',
    'https://ftp.lmi.is/stm/michaela/IslandsDEMv1/IslandsDEMv1_EPSG4326_bil.tif',
    true,
  ],
  [
    'DK DHM (WCS, needs token)',
    'https://api.dataforsyningen.dk/dhm_wcs_DAF?service=WCS&version=1.0.0&request=GetCoverage&coverage=dhm_terraen&crs=EPSG:25832&bbox=720000,6170000,720200,6170200&width=100&height=100&format=GTiff',
  ],
  [
    'FI NLS (WCS, needs key)',
    'https://avoin-karttakuva.maanmittauslaitos.fi/ortokuvat-ja-korkeusmallit/wcs/v2?service=WCS&request=GetCapabilities',
  ],
];

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };
const TAGS = { 256: 'w', 257: 'h', 258: 'bits', 259: 'compression', 322: 'tile', 339: 'format' };

/** The first image directory of a (Big)TIFF, or null when the bytes are not a TIFF. */
function tiffInfo(buf) {
  if (buf.length < 16) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = v.getUint16(0) === 0x4949;
  const big = v.getUint16(2, le) === 43;
  if (!big && v.getUint16(2, le) !== 42) return null;
  const at0 = big ? Number(v.getBigUint64(8, le)) : v.getUint32(4, le);
  if (at0 + 8 > buf.length)
    return { bigtiff: big, note: 'directory not in the first bytes (not a COG)' };
  const count = big ? Number(v.getBigUint64(at0, le)) : v.getUint16(at0, le);
  const out = { bigtiff: big };
  for (let i = 0; i < count; i++) {
    const at = big ? at0 + 8 + i * 20 : at0 + 2 + i * 12;
    const tag = v.getUint16(at, le);
    if (!TAGS[tag]) continue;
    const valueAt = big ? at + 12 : at + 8;
    out[TAGS[tag]] =
      TYPE_SIZE[v.getUint16(at + 2, le)] === 2
        ? v.getUint16(valueAt, le)
        : v.getUint32(valueAt, le);
  }
  return out;
}

/** WCS 2.0 may wrap the TIFF in multipart/related: skip to the TIFF magic. */
function unwrap(buf) {
  for (let i = 0; i < buf.length - 4; i++) {
    const le = buf[i] === 0x49 && buf[i + 1] === 0x49 && (buf[i + 2] === 42 || buf[i + 2] === 43);
    const be = buf[i] === 0x4d && buf[i + 1] === 0x4d && (buf[i + 3] === 42 || buf[i + 3] === 43);
    if (le || be) return buf.subarray(i);
  }
  return buf;
}

const filter = process.argv[2] ?? '';
for (const [label, url, ranged] of SOURCES.filter(([l]) => l.includes(filter))) {
  const headers = { Origin: 'https://example.github.io', 'User-Agent': 'summit-sketch-probe/1' };
  if (ranged) headers.Range = 'bytes=0-65535';
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(40_000) });
    const buf = new Uint8Array(await res.arrayBuffer());
    const cors = res.headers.get('access-control-allow-origin');
    const info = tiffInfo(unwrap(buf));
    const detail = info
      ? JSON.stringify(info)
      : new TextDecoder().decode(buf.subarray(0, 80)).replace(/\s+/g, ' ');
    // OK: a browser can read float elevations. INTEGER: readable, but whole units only.
    const readable = res.ok && cors !== null;
    const verdict = !readable
      ? 'BLOCKED'
      : info?.format === 3
        ? 'OK     '
        : info
          ? 'INTEGER'
          : 'OTHER  ';
    console.log(`${verdict} ${label.padEnd(30)} ${res.status} cors=${cors ?? '-'} ${detail}`);
  } catch (err) {
    console.log(`FAILED  ${label.padEnd(30)} ${err.cause?.code ?? err.name}: ${err.message}`);
  }
}
