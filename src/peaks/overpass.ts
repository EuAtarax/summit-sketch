import { distanceM } from '../geo/geodesy';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export interface Peak {
  id: number;
  lat: number;
  lon: number;
  name: string;
  /** Elevation from the OSM `ele` tag in meters, if present and plausible. */
  ele: number | null;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Named peaks only, as the data policy in CLAUDE.md asks. */
export function peakQuery(b: BBox): string {
  const f = (x: number) => x.toFixed(5);
  return (
    `[out:json][timeout:25];` +
    `node["natural"="peak"]["name"](${f(b.south)},${f(b.west)},${f(b.north)},${f(b.east)});` +
    `out body;`
  );
}

/**
 * Parses an OSM `ele` value to meters. Handles "2962", "2962 m", "2962.5", "2962,5",
 * "9,000 ft" and "4'478 m". Returns null for anything unparseable or implausible.
 */
export function parseEle(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const feet = /\bft\b|feet/.test(s); // an apostrophe is the Swiss thousands separator
  let num = s.match(/-?\d[\d,.' ]*/)?.[0]?.replace(/[' ]/g, '');
  if (!num) return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(num))
    num = num.replace(/,/g, ''); // thousands
  else num = num.replace(',', '.'); // decimal comma
  let v = Number.parseFloat(num);
  if (!Number.isFinite(v)) return null;
  if (feet) v *= 0.3048;
  return v >= -500 && v <= 9000 ? v : null;
}

interface OverpassJson {
  elements?: {
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
  }[];
}

export function parsePeaks(json: OverpassJson): Peak[] {
  const out: Peak[] = [];
  for (const e of json.elements ?? []) {
    if (e.type !== 'node' || e.lat === undefined || e.lon === undefined) continue;
    const name = e.tags?.name?.trim();
    if (!name) continue;
    out.push({ id: e.id, lat: e.lat, lon: e.lon, name, ele: parseEle(e.tags?.ele) });
  }
  return out;
}

/** The nearest peak within maxDistM of a point, or null. */
export function nearestPeak(
  peaks: readonly Peak[],
  lat: number,
  lon: number,
  maxDistM: number,
): Peak | null {
  let best: Peak | null = null;
  let bestD = maxDistM;
  for (const p of peaks) {
    if (Math.abs(p.lat - lat) * 111_000 > bestD) continue;
    const d = distanceM(lat, lon, p.lat, p.lon);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
