import { DSM_05M, DTM_2M, loadWindow } from '../terrain';
import type { TerrainSource } from './types';

/**
 * swisstopo: swissALTI3D (2 m, one small COG per km, found through STAC) and swissSURFACE3D
 * (0.5 m, read by range). The 2 m tiles are the analysis grid itself.
 */
export const swissSource: TerrainSource = {
  async terrain(g, onProgress, fetchFn) {
    const half = (g.width * g.cell) / 2;
    const w = await loadWindow(DTM_2M, g.e0 + half, g.n0 - half, half, onProgress, fetchFn);
    return w.data;
  },
  async surface(g, onProgress, fetchFn) {
    const half = (g.width * g.cell) / 2;
    const w = await loadWindow(DSM_05M, g.e0 + half, g.n0 - half, half, onProgress, fetchFn);
    return { data: w.data, factor: g.cell / DSM_05M.gsd };
  },
};
