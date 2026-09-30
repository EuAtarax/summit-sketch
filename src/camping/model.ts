import { patchMinimum, pitchSuitability, type SuitabilityParams } from './analysis';
import { overlayGrid, paintOverlay, type LayerId, type OverlayGrid } from './heatmap';
import { lv95ToWgs84, wgs84ToLv95 } from './lv95';
import type { PaletteId } from './palettes';
import type { AnalysisResult } from './pipeline';
import { hidesGround } from './protection';
import { campScore, pickSpots, type NearbyParams } from './scoring';
import { describeCell, describeSpot, protectedLayer, type SpotItem } from './summary';

/** The settings that change the camp score (everything else only changes colors). */
export interface ScoreSettings {
  suitability: SuitabilityParams;
  nearby: NearbyParams;
  hideProtected: boolean;
}

/** A best spot as the page shows it: a list entry and a map marker. */
export interface SpotView extends SpotItem {
  lat: number;
  lon: number;
}

/** A painted layer, ready to become an image on the map. */
export interface OverlayPixels {
  width: number;
  height: number;
  bounds: OverlayGrid['bounds'];
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * One analysis and everything derived from it: suitability, camp score, best spots and the
 * heatmap pixels. Lives in the analysis worker, so moving a slider (millions of cells) never
 * blocks the page; the page only receives the spots and a finished image.
 */
export class CampModel {
  private suitability: Float32Array | null = null;
  private score: Float32Array | null = null;
  private scoredWith = '';
  private spots: SpotView[] = [];
  private readonly protectedValues: Float32Array | null;
  private grid: OverlayGrid | null = null;

  constructor(readonly result: AnalysisResult) {
    this.protectedValues = protectedLayer(result);
  }

  /** Recomputes the score and the best spots, unless the settings are the ones last used. */
  rescore(s: ScoreSettings): SpotView[] {
    const key = JSON.stringify(s);
    if (key === this.scoredWith) return this.spots;
    const r = this.result;
    const { width, height } = r.geometry;
    this.suitability = patchMinimum(
      pitchSuitability(r.slope, r.roughness, r.canopy, s.suitability, r.water),
      width,
      height,
      s.suitability.patchRadiusCells,
    );
    this.score = campScore(
      {
        suitability: this.suitability,
        ...(r.trailDistance ? { trailDistance: r.trailDistance } : {}),
        ...(r.waterDistance ? { waterDistance: r.waterDistance } : {}),
        ...(r.drinkingDistance ? { drinkingDistance: r.drinkingDistance } : {}),
        ...(r.protectionIndex
          ? { protection: { index: r.protectionIndex, hides: r.areas.map(hidesGround) } }
          : {}),
      },
      s.nearby,
      s.hideProtected,
    );
    this.spots = pickSpots(this.score, r.geometry).map((spot) => ({
      ...describeSpot(r, spot),
      ...lv95ToWgs84(spot.e, spot.n),
    }));
    this.scoredWith = key;
    return this.spots;
  }

  private valuesOf(layer: LayerId): Float32Array | null {
    const r = this.result;
    const byLayer: Record<LayerId, Float32Array | null | undefined> = {
      score: this.score,
      suitability: this.suitability,
      slope: r.slope,
      roughness: r.roughness,
      canopy: r.canopy,
      water: r.water,
      protected: this.protectedValues,
    };
    return byLayer[layer] ?? null;
  }

  /** The layer as pixels, or null when this analysis has no such data (e.g. no vegetation). */
  paint(layer: LayerId, palette: PaletteId): OverlayPixels | null {
    const values = this.valuesOf(layer);
    if (!values) return null;
    this.grid ??= overlayGrid(this.result.geometry);
    const { width, height, bounds } = this.grid;
    return { width, height, bounds, rgba: paintOverlay(this.grid, values, layer, palette) };
  }

  /** The numbers behind the cell at a position (hover readout), or null outside the data. */
  describeAt(lat: number, lon: number): string | null {
    const g = this.result.geometry;
    const p = wgs84ToLv95(lat, lon);
    const col = Math.floor((p.e - g.e0) / g.cell);
    const row = Math.floor((g.n0 - p.n) / g.cell);
    if (col < 0 || row < 0 || col >= g.width || row >= g.height) return null;
    const i = row * g.width + col;
    const score = this.score?.[i];
    if (score === undefined || Number.isNaN(score)) return null;
    const rough = `${this.result.roughness[i]!.toFixed(2)} m rough`;
    return `Score ${Math.round(score * 100)} %, ${describeCell(this.result, col, row)}, ${rough}`;
  }
}
