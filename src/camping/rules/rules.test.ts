import { describe, expect, it } from 'vitest';
import { ALL_RULES, lookupSwissPlace, parseSwissPlace, rulesFor, swissPlaceUrl } from './index';

const CANTONS = [
  'AG',
  'AI',
  'AR',
  'BE',
  'BL',
  'BS',
  'FR',
  'GE',
  'GL',
  'GR',
  'JU',
  'LU',
  'NE',
  'NW',
  'OW',
  'SG',
  'SH',
  'SO',
  'SZ',
  'TG',
  'TI',
  'UR',
  'VD',
  'VS',
  'ZG',
  'ZH',
];
const LAENDER = ['AT-1', 'AT-2', 'AT-3', 'AT-4', 'AT-5', 'AT-6', 'AT-7', 'AT-8', 'AT-9'];

describe('the rules data', () => {
  it('has one entry per canton and Bundesland, and one per country', () => {
    const regions = (country: string) =>
      ALL_RULES.filter((r) => r.country === country && r.level === 'region')
        .map((r) => r.region)
        .sort();
    expect(regions('CH')).toEqual([...CANTONS].sort());
    expect(regions('AT')).toEqual([...LAENDER].sort());
    for (const country of ['CH', 'AT'])
      expect(ALL_RULES.filter((r) => r.country === country && r.level === 'country')).toHaveLength(
        1,
      );
  });

  it.each(ALL_RULES.map((r) => [r.name, r] as const))('%s is sourced and dated', (_, r) => {
    expect(r.sources.length).toBeGreaterThan(0);
    for (const s of r.sources) expect(s.url).toMatch(/^https:\/\//);
    expect(r.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.summary.length).toBeGreaterThan(10);
    if (r.level === 'commune') expect(r.region && r.commune).toBeTruthy();
  });

  it('never tells anyone that camping is allowed (CLAUDE.md)', () => {
    for (const r of ALL_RULES) {
      for (const text of [r.summary, ...r.details]) expect(text).not.toMatch(/\ballow/i);
    }
  });
});

describe('rulesFor', () => {
  it('returns commune, canton and country entries, most specific first', () => {
    const found = rulesFor({ country: 'CH', region: 'BE', commune: 'Lauterbrunnen' });
    expect(found.map((r) => r.level)).toEqual(['commune', 'region', 'country']);
    expect(found[0]!.name).toBe('Lauterbrunnen');
  });

  it('matches communes within their canton only, and knows nothing about other countries', () => {
    expect(rulesFor({ country: 'CH', region: 'OW', commune: 'Lauterbrunnen' })).toHaveLength(2);
    expect(rulesFor({ country: 'CH', region: 'OW' })[0]!.name).toBe('Obwalden');
    expect(rulesFor({ country: 'FR' })).toEqual([]);
  });
});

const ANSWER = {
  results: [
    {
      layerBodId: 'ch.swisstopo.swissboundaries3d-kanton-flaeche.fill',
      properties: { ak: 'BE', name: 'Bern' },
    },
    {
      layerBodId: 'ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill',
      properties: { gemname: 'Old name', jahr: 2025 },
    },
    {
      layerBodId: 'ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill',
      properties: { gemname: 'Lauterbrunnen', jahr: 2026 },
    },
  ],
};

describe('Swiss place lookup', () => {
  it('asks for canton and commune of one year at the point', () => {
    const url = new URL(swissPlaceUrl(46.59, 7.91, 2026));
    expect(url.searchParams.get('geometry')).toBe('7.91,46.59');
    expect(url.searchParams.get('timeInstant')).toBe('2026');
    expect(url.searchParams.get('layers')).toContain('kanton');
    expect(url.searchParams.get('layers')).toContain('gemeinde');
  });

  it('takes the canton and the most recent commune', () => {
    expect(parseSwissPlace(ANSWER)).toEqual({
      country: 'CH',
      region: 'BE',
      regionName: 'Bern',
      commune: 'Lauterbrunnen',
    });
    expect(parseSwissPlace({ results: [] })).toBeNull();
  });

  it('asks a year back when this year has no communes yet', async () => {
    const years: string[] = [];
    const fetchFn = async (url: string) => {
      const year = new URL(url).searchParams.get('timeInstant')!;
      years.push(year);
      const body = year === '2027' ? { results: [ANSWER.results[0]] } : ANSWER;
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const place = await lookupSwissPlace(46.59, 7.91, fetchFn, new Date('2027-01-03'));
    expect(years).toEqual(['2027', '2026']);
    expect(place?.commune).toBe('Lauterbrunnen');
  });
});
