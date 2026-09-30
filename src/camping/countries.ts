import type { CrsId } from './crs';

/**
 * The countries the camping finder has terrain for, and what differs between them. This file
 * is shared by the page and the worker, so it holds only plain data; the loaders live in
 * sources/ (worker side).
 */
export type CountryId = 'ch' | 'at' | 'fr';

export interface CountryInfo {
  id: CountryId;
  name: string;
  /** ISO 3166-1 alpha-2 codes (lower case) this data covers; Liechtenstein uses Swiss data. */
  isoCodes: readonly string[];
  /** The grid the analysis runs in. */
  crs: CrsId;
  /** Credit for the terrain data, shown in the map's attribution (HTML). */
  terrainCredit: string;
  /** Protected areas: Swiss federal inventories (BAFU) or the EU's (EEA) services. */
  protection: 'bafu' | 'eea';
  /** Largest box with vegetation height (the surface model is a big download), km. */
  maxCanopyKm: number;
}

export const COUNTRIES: Record<CountryId, CountryInfo> = {
  ch: {
    id: 'ch',
    name: 'Switzerland',
    isoCodes: ['ch', 'li'],
    crs: 'EPSG:2056',
    terrainCredit:
      'Terrain: swissALTI3D © <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>',
    protection: 'bafu',
    maxCanopyKm: 1,
  },
  at: {
    id: 'at',
    name: 'Austria',
    isoCodes: ['at'],
    crs: 'EPSG:3035',
    terrainCredit:
      'Terrain: ALS DGM/DOM <a href="https://www.bev.gv.at" target="_blank" rel="noopener">BEV</a> (CC BY 4.0)',
    protection: 'eea',
    maxCanopyKm: 2,
  },
  fr: {
    id: 'fr',
    name: 'France',
    isoCodes: ['fr'],
    crs: 'EPSG:3035',
    terrainCredit:
      'Terrain: RGE ALTI, MNS © <a href="https://www.ign.fr" target="_blank" rel="noopener">IGN</a> (Licence Ouverte)',
    protection: 'eea',
    maxCanopyKm: 1,
  },
};

/** The country whose data covers an ISO code, or null when there is none yet. */
export function countryForIso(iso: string): CountryInfo | null {
  const code = iso.toLowerCase();
  return Object.values(COUNTRIES).find((c) => c.isoCodes.includes(code)) ?? null;
}

/** "Switzerland, Liechtenstein, Austria and France", for messages. */
export const COVERED_NAMES = 'Switzerland, Liechtenstein, Austria and France';
