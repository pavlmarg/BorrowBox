import sharp from 'sharp';
import {
  InvalidImageError,
  processImage,
  type ImageRules,
  type InvalidImageReason,
} from './image';

const ALLOWED = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/tiff',
];
const WIDTHS = { small: 320, medium: 800, large: 1600 };

function rules(overrides: Partial<ImageRules> = {}): ImageRules {
  return {
    declaredType: 'image/jpeg',
    allowedTypes: ALLOWED,
    maxBytes: 10 * 1024 * 1024,
    maxPixels: 50_000_000,
    minWidth: 320,
    widths: WIDTHS,
    ...overrides,
  };
}

function canvas(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  });
}

/** Big- and little-endian bytes of a TIFF rational, as EXIF stores GPS. */
function rational(n: number, d: number): Buffer[] {
  const be = Buffer.alloc(8);
  be.writeUInt32BE(n, 0);
  be.writeUInt32BE(d, 4);
  const le = Buffer.alloc(8);
  le.writeUInt32LE(n, 0);
  le.writeUInt32LE(d, 4);
  return [be, le];
}

async function reason(promise: Promise<unknown>): Promise<InvalidImageReason> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidImageError);
    return (err as InvalidImageError).reason;
  }
  throw new Error('expected the image to be rejected');
}

describe('processImage', () => {
  describe('a phone photo with GPS, camera details, XMP and a colour profile', () => {
    let photo: Buffer;

    beforeAll(async () => {
      photo = await canvas(1200, 800)
        .jpeg()
        .withExif({
          IFD0: {
            Make: 'TestCam',
            Model: 'Secret-Phone-9',
            Copyright: 'Maria Papadopoulou',
          },
          // libvips names the GPS IFD "IFD3". 37°58'51" N, 23°43'39" E.
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '37/1 58/1 51/1',
            GPSLongitudeRef: 'E',
            GPSLongitude: '23/1 43/1 39/1',
          },
        })
        .withXmp(
          '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>home-address-secret</rdf:Description></rdf:RDF></x:xmpmeta>',
        )
        .withIccProfile('p3')
        .withMetadata({ orientation: 6 })
        .toBuffer();
    });

    it('really carries all of that metadata going in', async () => {
      const meta = await sharp(photo).metadata();
      expect(meta.orientation).toBe(6);
      expect(meta.exif?.includes('Secret-Phone-9')).toBe(true);
      // The GPS latitude (37/1) is stored as a binary rational.
      expect(rational(37, 1).some((bytes) => meta.exif?.includes(bytes))).toBe(
        true,
      );
      expect(meta.xmp?.toString()).toContain('home-address-secret');
      expect(meta.icc).toBeDefined();
    });

    it('comes out with no metadata at all, in every size', async () => {
      const { sizes, sourceType } = await processImage(photo, rules());
      expect(sourceType).toBe('image/jpeg');
      expect(Object.keys(sizes).sort()).toEqual(['large', 'medium', 'small']);

      for (const output of Object.values(sizes)) {
        const meta = await sharp(output).metadata();
        expect(meta.format).toBe('webp');
        expect(meta.exif).toBeUndefined();
        expect(meta.xmp).toBeUndefined();
        expect(meta.icc).toBeUndefined();
        expect(meta.iptc).toBeUndefined();
        expect(meta.orientation).toBeUndefined();
        // And nothing hidden elsewhere in the file.
        for (const secret of [
          'Secret-Phone-9',
          'TestCam',
          'Maria',
          'home-address-secret',
          'xmpmeta',
          'EXIF',
          'XMP ',
          'ICCP',
        ]) {
          expect(output.includes(secret)).toBe(false);
        }
        for (const bytes of [...rational(37, 1), ...rational(23, 1)]) {
          expect(output.includes(bytes)).toBe(false);
        }
      }
    });

    it('applies the orientation, so a portrait photo stays upright', async () => {
      const { sizes } = await processImage(photo, rules());
      // 1200×800 stored, orientation 6 (90°): shown 800 wide, 1200 high.
      const large = await sharp(sizes['large']).metadata();
      expect([large.width, large.height]).toEqual([800, 1200]);
      const small = await sharp(sizes['small']).metadata();
      expect([small.width, small.height]).toEqual([320, 480]);
    });
  });

  it.each([
    ['image/jpeg', () => canvas(900, 600).jpeg()],
    ['image/png', () => canvas(900, 600).png()],
    ['image/webp', () => canvas(900, 600).webp()],
    ['image/avif', () => canvas(900, 600).avif()],
    ['image/gif', () => canvas(900, 600).gif()],
    ['image/tiff', () => canvas(900, 600).tiff()],
  ])('accepts %s and never enlarges it', async (type, make) => {
    const input = await make().toBuffer();
    const { sizes, sourceType } = await processImage(
      input,
      rules({ declaredType: type }),
    );
    expect(sourceType).toBe(type);
    const widths = await Promise.all(
      ['small', 'medium', 'large'].map(
        async (name) => (await sharp(sizes[name]).metadata()).width,
      ),
    );
    expect(widths).toEqual([320, 800, 900]);
  });

  it('rejects an SVG, even declared as a PNG', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><script>alert(1)</script><rect width="800" height="600"/></svg>',
    );
    expect(
      await reason(processImage(svg, rules({ declaredType: 'image/png' }))),
    ).toBe('UNSUPPORTED_TYPE');
  });

  it('rejects a file that is not an image', async () => {
    expect(
      await reason(
        processImage(Buffer.from('just some text, not a JPEG'), rules()),
      ),
    ).toBe('UNREADABLE');
  });

  it('rejects a truncated JPEG', async () => {
    const whole = await canvas(1200, 800).jpeg().toBuffer();
    const cut = whole.subarray(0, Math.floor(whole.length / 2));
    expect(await reason(processImage(cut, rules()))).toBe('UNREADABLE');
  });

  it('rejects a real type other than the declared one', async () => {
    const png = await canvas(900, 600).png().toBuffer();
    expect(
      await reason(processImage(png, rules({ declaredType: 'image/jpeg' }))),
    ).toBe('TYPE_MISMATCH');
  });

  it('rejects files over the size limit before decoding them', async () => {
    const jpeg = await canvas(900, 600).jpeg().toBuffer();
    expect(
      await reason(processImage(jpeg, rules({ maxBytes: jpeg.length - 1 }))),
    ).toBe('TOO_LARGE');
  });

  it('rejects images with more pixels than allowed (decompression bombs)', async () => {
    // A small, highly compressible file that decodes to many pixels.
    const bomb = await canvas(1200, 1000)
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(50_000);
    expect(
      await reason(
        processImage(
          bomb,
          rules({ declaredType: 'image/png', maxPixels: 1_000_000 }),
        ),
      ),
    ).toBe('TOO_LARGE');
  });

  it('rejects photos narrower than the minimum, counting the orientation', async () => {
    const narrow = await canvas(300, 600).jpeg().toBuffer();
    expect(await reason(processImage(narrow, rules()))).toBe('TOO_SMALL');
    // Stored 1000×300 but shown turned: 300 wide.
    const turned = await canvas(1000, 300)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(await reason(processImage(turned, rules()))).toBe('TOO_SMALL');
  });
});
