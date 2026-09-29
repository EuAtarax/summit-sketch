/** Map overlays from swisstopo's geo.admin.ch (all free, CORS-open WMTS tiles). */
export interface OverlayDef {
  id: string;
  label: string;
  /** geo.admin.ch layer id. */
  layer: string;
  group: 'paths' | 'protected';
  /** One line for the panel: what it is and why it matters for camping. */
  note: string;
  /** Data owner shown in the map credit. */
  credit: 'swisstopo' | 'BAFU';
}

export const OVERLAYS: readonly OverlayDef[] = [
  {
    id: 'trails',
    label: 'Hiking trails',
    layer: 'ch.swisstopo.swisstlm3d-wanderwege',
    group: 'paths',
    note: 'Marked hiking paths of Switzerland.',
    credit: 'swisstopo',
  },
  {
    id: 'wildlife-zones',
    label: 'Wildlife quiet zones',
    layer: 'ch.bafu.wrz-wildruhezonen_portal',
    group: 'protected',
    note: 'Winter and spring refuges for game; access rules vary, some ban leaving the path.',
    credit: 'BAFU',
  },
  {
    id: 'game-reserves',
    label: 'Game reserves (Jagdbanngebiete)',
    layer: 'ch.bafu.bundesinventare-jagdbanngebiete',
    group: 'protected',
    note: 'Federal wildlife protection areas.',
    credit: 'BAFU',
  },
  {
    id: 'national-park',
    label: 'Swiss National Park',
    layer: 'ch.bafu.schutzgebiete-schweizerischer_nationalpark',
    group: 'protected',
    note: 'Strict rules: camping is forbidden.',
    credit: 'BAFU',
  },
  {
    id: 'bird-reserves',
    label: 'Waterfowl and migratory bird reserves',
    layer: 'ch.bafu.bundesinventare-vogelreservate',
    group: 'protected',
    note: 'Federal bird reserves.',
    credit: 'BAFU',
  },
  {
    id: 'floodplains',
    label: 'Floodplains (Auen)',
    layer: 'ch.bafu.bundesinventare-auen',
    group: 'protected',
    note: 'Protected river landscapes; also flood-prone.',
    credit: 'BAFU',
  },
  {
    id: 'moor-landscapes',
    label: 'Moorland landscapes',
    layer: 'ch.bafu.bundesinventare-moorlandschaften',
    group: 'protected',
    note: 'Protected moorland; wet, fragile ground.',
    credit: 'BAFU',
  },
  {
    id: 'raised-bogs',
    label: 'Raised bogs',
    layer: 'ch.bafu.bundesinventare-hochmoore',
    group: 'protected',
    note: 'Protected bogs; keep out.',
    credit: 'BAFU',
  },
  {
    id: 'fens',
    label: 'Fens',
    layer: 'ch.bafu.bundesinventare-flachmoore',
    group: 'protected',
    note: 'Protected fens; wet and fragile.',
    credit: 'BAFU',
  },
  {
    id: 'parks',
    label: 'Nature parks',
    layer: 'ch.bafu.schutzgebiete-paerke_nationaler_bedeutung',
    group: 'protected',
    note: 'Parks of national importance; local rules apply.',
    credit: 'BAFU',
  },
];

export const overlayTileUrl = (layer: string): string =>
  `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.png`;

export const CREDITS: Record<OverlayDef['credit'], string> = {
  swisstopo: '© swisstopo',
  BAFU: 'Source: FOEN (BAFU)',
};
