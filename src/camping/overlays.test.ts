import { describe, expect, it } from 'vitest';
import { CREDITS, OVERLAYS, overlayTileUrl } from './overlays';

describe('OVERLAYS', () => {
  it('has unique ids and geo.admin layer ids', () => {
    expect(new Set(OVERLAYS.map((o) => o.id)).size).toBe(OVERLAYS.length);
    expect(new Set(OVERLAYS.map((o) => o.layer)).size).toBe(OVERLAYS.length);
    for (const o of OVERLAYS) expect(o.layer).toMatch(/^ch\.[a-z0-9]+\.[a-z0-9_.-]+$/);
  });

  it('offers hiking trails and the main protected-area layers', () => {
    const ids = OVERLAYS.map((o) => o.id);
    for (const id of ['trails', 'wildlife-zones', 'game-reserves', 'national-park']) {
      expect(ids).toContain(id);
    }
  });

  it('explains every overlay and credits its data owner', () => {
    for (const o of OVERLAYS) {
      expect(o.note.length).toBeGreaterThan(10);
      expect(CREDITS[o.credit]).toBeTruthy();
    }
  });

  it('builds a Leaflet tile template for the Web Mercator tile matrix', () => {
    const url = overlayTileUrl('ch.bafu.wrz-wildruhezonen_portal');
    expect(url).toBe(
      'https://wmts.geo.admin.ch/1.0.0/ch.bafu.wrz-wildruhezonen_portal/default/current/3857/{z}/{x}/{y}.png',
    );
  });
});
