import type { PanoramaStyle } from '../style';
import { cartoonStyle } from './cartoon';
import { debugStyle } from './debugStyle';
import { mistyStyle } from './misty';
import { pencilStyle } from './pencil';

/** User-facing styles, in picker order. */
export const STYLES: readonly PanoramaStyle[] = [pencilStyle, mistyStyle, cartoonStyle];

/** Styles for this session: the debug style is added behind ?debug=1. */
export function availableStyles(debug: boolean): readonly PanoramaStyle[] {
  return debug ? [...STYLES, debugStyle] : STYLES;
}

export const DEFAULT_STYLE_ID = pencilStyle.id;
