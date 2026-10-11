import { checkDecoded, planUndecodable, scaledSize } from './photo-prep';

describe('scaledSize', () => {
  it('leaves photos that fit alone', () => {
    expect(scaledSize(1600, 1200)).toEqual({ width: 1600, height: 1200 });
  });

  it('scales the longer side down to 2048 px, keeping the shape', () => {
    expect(scaledSize(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(scaledSize(3024, 4032)).toEqual({ width: 1536, height: 2048 });
  });
});

describe('planUndecodable', () => {
  it('uploads an accepted type the browser can’t show, as it is', () => {
    expect(planUndecodable({ type: 'image/tiff', size: 1000 })).toBe(
      'upload-as-is',
    );
  });

  it('refuses HEIC outside Safari and anything else unknown', () => {
    expect(planUndecodable({ type: 'image/heic', size: 1000 })).toEqual({
      ok: false,
      problem: 'unsupported',
    });
    expect(planUndecodable({ type: 'image/svg+xml', size: 10 })).toEqual({
      ok: false,
      problem: 'unsupported',
    });
  });

  it('refuses files over 10 MB', () => {
    expect(
      planUndecodable({ type: 'image/tiff', size: 11 * 1024 * 1024 }),
    ).toEqual({ ok: false, problem: 'tooLarge' });
  });
});

describe('checkDecoded', () => {
  it('needs at least 320 px of width', () => {
    expect(checkDecoded(319)).toBe('tooSmall');
    expect(checkDecoded(320)).toBeNull();
  });
});
