import { labelUpdates, localisedName } from './map-labels';

const layers = [
  { id: 'water', type: 'fill' },
  { id: 'place-city', type: 'symbol', layout: { 'text-field': '{name}' } },
  {
    id: 'road-label',
    type: 'symbol',
    layout: {
      'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
    },
  },
  {
    id: 'housenumber',
    type: 'symbol',
    layout: { 'text-field': '{housenumber}' },
  },
  { id: 'road-shield', type: 'symbol', layout: { 'text-field': '{ref}' } },
  { id: 'poi-icon', type: 'symbol', layout: { 'icon-image': 'shop' } },
  {
    id: 'airport',
    type: 'symbol',
    layout: {
      'text-field': {
        stops: [
          [9, '{iata}'],
          [12, '{name:en}'],
        ],
      },
    },
  },
];

describe('labelUpdates', () => {
  it('relabels only the layers that show place names', () => {
    expect(labelUpdates(layers, 'el').map((u) => u.layerId)).toEqual([
      'place-city',
      'road-label',
    ]);
  });

  it('uses Greek names in Greek', () => {
    expect(labelUpdates(layers, 'el')[0].textField).toEqual([
      'coalesce',
      ['get', 'name:el'],
      ['get', 'name'],
    ]);
  });
});

describe('localisedName', () => {
  it('falls back to the transliteration before the local name in English', () => {
    expect(localisedName('en')).toEqual([
      'coalesce',
      ['get', 'name:en'],
      ['get', 'name:latin'],
      ['get', 'name'],
    ]);
  });
});
