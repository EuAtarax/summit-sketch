import type { BBox } from '../geo/bbox';
import type { FetchFn } from '../net/fetch';
import { sortForPainting, type ProtectedArea } from './protection';
import type { Point, Polygon } from './raster';

/**
 * Protected areas outside Switzerland, from the European Environment Agency's services
 * (CORS-open, no key): Natura 2000 sites and the nationally designated areas (national parks,
 * nature reserves, ...). The outlines come back in the analysis grid's CRS (outSR), so no
 * projection happens here. Camping rules are not in these data: a Natura 2000 site protects
 * habitats and is listed for information; a nationally designated area restricts ground when
 * the EEA marks it as strictly protected or as IUCN Ia/Ib. The national rules still apply.
 */
const BASE = 'https://bio.discomap.eea.europa.eu/arcgis/rest/services/ProtectedSites';

interface Layer {
  id: string;
  path: string;
  fields: string;
}

const LAYERS: readonly Layer[] = [
  {
    id: 'eea:natura2000-habitats',
    path: 'Natura2000Sites/MapServer/0',
    fields: 'SITECODE,SITENAME',
  },
  { id: 'eea:natura2000-birds', path: 'Natura2000Sites/MapServer/1', fields: 'SITECODE,SITENAME' },
  // Layer 3 answers in well under a second; the large-scale layer 4 timed out in tests. Its
  // outlines are generalized (about 100 m), which the panel says.
  {
    id: 'eea:natda',
    path: 'NatDAv24_Dyna_WM/MapServer/3',
    fields: 'siteName,iucnCategory,strictProtection',
  },
];

const IUCN_KIND: Record<string, string> = {
  Ia: 'Strict nature reserve',
  Ib: 'Wilderness area',
  II: 'National park',
  III: 'Natural monument',
  IV: 'Habitat protection area',
  V: 'Protected landscape',
  VI: 'Protected area with sustainable use',
};

export function eeaQueryUrl(layer: Layer, box: BBox, wkid: number): string {
  const params = new URLSearchParams({
    geometry: `${box.west},${box.south},${box.east},${box.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: layer.fields,
    returnGeometry: 'true',
    outSR: String(wkid),
    // Simplify to about the grid cell and round to decimeters: smaller answers, same raster.
    maxAllowableOffset: '2',
    geometryPrecision: '1',
    f: 'json',
  });
  return `${BASE}/${layer.path}/query?${params}`;
}

interface EsriAnswer {
  features?: { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }[];
  error?: { message?: string };
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Turns one layer's answer into protected areas (rings as one even-odd polygon each). */
export function parseEea(json: EsriAnswer, layerId: string): ProtectedArea[] {
  if (json.error) throw new Error(`EEA service error: ${json.error.message ?? 'unknown'}`);
  const areas: ProtectedArea[] = [];
  for (const f of json.features ?? []) {
    const rings = f.geometry?.rings;
    if (!rings || rings.length === 0) continue;
    const polygon: Polygon = rings.map((r) => r.map(([e, n]) => [e!, n!] as Point));
    const a = f.attributes ?? {};
    if (layerId === 'eea:natda') {
      const iucn = text(a.iucnCategory);
      const strict = text(a.strictProtection) === 'yes';
      areas.push({
        layer: layerId,
        kind: iucn && IUCN_KIND[iucn] ? `${IUCN_KIND[iucn]} (IUCN ${iucn})` : 'Protected area',
        name: text(a.siteName) ?? 'Unnamed area',
        rule: strict ? 'Strictly protected (EEA)' : null,
        period: null,
        inForce: true,
        restricts: strict || iucn === 'Ia' || iucn === 'Ib',
        polygons: [polygon],
      });
    } else {
      areas.push({
        layer: layerId,
        kind:
          layerId === 'eea:natura2000-birds' ? 'Natura 2000 bird site' : 'Natura 2000 habitat site',
        name: text(a.SITENAME) ?? text(a.SITECODE) ?? 'Unnamed site',
        rule: null,
        period: null,
        inForce: true,
        restricts: false,
        polygons: [polygon],
      });
    }
  }
  return areas;
}

/** All EEA protected areas that touch a WGS84 box, outlines in the grid `wkid`. */
export async function fetchEeaAreas(
  box: BBox,
  wkid: number,
  fetchFn: FetchFn = (u, init) => fetch(u, init),
): Promise<ProtectedArea[]> {
  const answers = await Promise.all(
    LAYERS.map(async (layer) => {
      const res = await fetchFn(eeaQueryUrl(layer, box, wkid), {
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`EEA protected areas failed (HTTP ${res.status})`);
      return parseEea((await res.json()) as EsriAnswer, layer.id);
    }),
  );
  return sortForPainting(answers.flat());
}
