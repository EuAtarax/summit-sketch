/**
 * Camping rules by area: what the law says about pitching a tent outside a campsite, per
 * country, per region (canton, Bundesland) and, where known, per commune. The texts describe
 * the law; they never say that a spot is allowed (CLAUDE.md), and the page always adds that
 * landowners, communes and protected areas can add rules.
 */

/**
 * The gist of a rule for a tent outside campsites at this level:
 * - `ban`: forbidden by a general rule at this level (exceptions are in the details).
 * - `permit`: needs a permit or the landowner's consent.
 * - `conditional`: this level's law permits it under stated conditions (e.g. one night).
 * - `local`: no general rule at this level; lower levels and protected areas decide.
 */
export type Stance = 'ban' | 'permit' | 'conditional' | 'local';

/** How far an entry has been checked. */
export type Verification =
  /** Read in the law text or an official page. */
  | 'primary'
  /** From a reputable summary that names the law; the law itself was not read. */
  | 'secondary';

export interface RuleSource {
  title: string;
  url: string;
}

export interface RuleEntry {
  /** ISO 3166-1 alpha-2, e.g. "CH". */
  country: string;
  level: 'country' | 'region' | 'commune';
  /** Region code (canton "OW", ISO 3166-2 "AT-7"); for a commune also its name. */
  region?: string;
  commune?: string;
  name: string;
  /** Tents outside campsites. */
  stance: Stance;
  /** High-mountain bivouac, when the law treats it differently. */
  bivouac?: Stance;
  /** One sentence, plain English. */
  summary: string;
  /** Conditions, exceptions, fines, laws; each a short sentence. */
  details: string[];
  sources: RuleSource[];
  verification: Verification;
  /** ISO date the entry was last checked. */
  checkedOn: string;
}
