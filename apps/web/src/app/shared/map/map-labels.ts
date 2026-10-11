import type { AddLayerObject } from 'maplibre-gl';
import type { Locale } from '../../api/models';

/** The bit of a style layer this needs; MapLibre's layers fit it. */
export interface LabelLayer {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
}

type SymbolLayout = NonNullable<
  Extract<AddLayerObject, { type: 'symbol' }>['layout']
>;
export type TextField = NonNullable<SymbolLayout['text-field']>;

/**
 * Place names in the UI language, falling back to the local name (D5).
 * English also tries `name:latin`, the transliteration OpenMapTiles styles
 * carry, before the Greek local name.
 */
export function localisedName(lang: Locale): TextField {
  return lang === 'en'
    ? ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']]
    : ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
}

// A text field that shows a place's name ("{name}", ["get", "name:latin"], …).
const SHOWS_NAME = /["{]name(?:[:_][a-z]+)?["}]/;
// …but not house numbers or road refs, which have no translation.
const NOT_A_NAME = /housenumber|"ref"|\{ref\}/;

/**
 * Which symbol layers show place names, and the text field each should
 * get. Layers that don't match the pattern keep the style's own labels.
 */
export function labelUpdates(
  layers: readonly LabelLayer[],
  lang: Locale,
): Array<{ layerId: string; textField: TextField }> {
  const textField = localisedName(lang);
  return layers.flatMap((layer) => {
    if (layer.type !== 'symbol') return [];
    const current = layer.layout?.['text-field'];
    // Old-style zoom functions ({ stops: … }) often show other text at some
    // zooms (e.g. airport codes): leave those as the style has them.
    if (typeof current !== 'string' && !Array.isArray(current)) return [];
    const json = JSON.stringify(current);
    if (!SHOWS_NAME.test(json) || NOT_A_NAME.test(json)) return [];
    return [{ layerId: layer.id, textField }];
  });
}
