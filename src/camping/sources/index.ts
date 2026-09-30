import type { CountryId } from '../countries';
import { austriaSource } from './austria';
import { franceSource } from './france';
import { swissSource } from './swiss';
import type { TerrainSource } from './types';

export type { TerrainSource, TileProgress } from './types';

/** The terrain source of each country (worker side). */
export const SOURCES: Record<CountryId, TerrainSource> = {
  ch: swissSource,
  at: austriaSource,
  fr: franceSource,
};
