import { DISTANCE_BANDS } from '@borrowbox/contracts';
import { decodeCursor, distanceBand, encodeCursor } from './search-paging';

describe('search cursor', () => {
  const cursor = {
    distanceM: 1234.5678901234,
    itemId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  };

  it('round-trips exactly, including the full distance', () => {
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'abc+/='],
    ['not JSON', Buffer.from('nope').toString('base64url')],
    ['JSON null', Buffer.from('null').toString('base64url')],
    [
      'a negative distance',
      Buffer.from(JSON.stringify({ d: -1, i: cursor.itemId })).toString(
        'base64url',
      ),
    ],
    [
      'a distance as text',
      Buffer.from(JSON.stringify({ d: '1', i: cursor.itemId })).toString(
        'base64url',
      ),
    ],
    [
      'a malformed id',
      Buffer.from(JSON.stringify({ d: 1, i: "x' OR 1=1" })).toString(
        'base64url',
      ),
    ],
    ['far too long', 'a'.repeat(201)],
  ])('rejects %s', (_, value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});

describe('distanceBand', () => {
  it.each([
    [0, 'UNDER_1_KM'],
    [999.9, 'UNDER_1_KM'],
    [1_000, '1_2_KM'],
    [1_999.9, '1_2_KM'],
    [2_000, '2_5_KM'],
    [4_999.9, '2_5_KM'],
    [5_000, '5_10_KM'],
    [9_999.9, '5_10_KM'],
    [10_000, 'OVER_10_KM'],
    [49_000, 'OVER_10_KM'],
  ])('%d m → %s', (metres, band) => {
    expect(distanceBand(metres)).toBe(band);
  });

  it('only returns bands from the contracts', () => {
    for (const m of [0, 1_500, 3_000, 7_000, 20_000]) {
      expect(DISTANCE_BANDS).toContain(distanceBand(m));
    }
  });
});
