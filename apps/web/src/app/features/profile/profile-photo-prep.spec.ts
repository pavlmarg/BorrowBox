import {
  checkProfileDecoded,
  PROFILE_PHOTO_CLIENT_EDGE_PX,
  squareCrop,
} from './profile-photo-prep';

describe('squareCrop', () => {
  it('takes the centred square of a landscape photo, scaled down', () => {
    expect(squareCrop(4000, 3000)).toEqual({
      sx: 500,
      sy: 0,
      side: 3000,
      edge: PROFILE_PHOTO_CLIENT_EDGE_PX,
    });
  });

  it('takes the centred square of a portrait photo', () => {
    expect(squareCrop(600, 900)).toEqual({
      sx: 0,
      sy: 150,
      side: 600,
      edge: 600,
    });
  });

  it('never enlarges a small photo', () => {
    expect(squareCrop(200, 200).edge).toBe(200);
  });
});

describe('checkProfileDecoded', () => {
  it('refuses photos whose shorter side is under 128 px', () => {
    expect(checkProfileDecoded(2000, 100)).toBe('tooSmall');
    expect(checkProfileDecoded(127, 500)).toBe('tooSmall');
    expect(checkProfileDecoded(128, 128)).toBeNull();
  });
});
