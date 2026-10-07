import sharp, { type Metadata } from 'sharp';

/**
 * Turns an uploaded photo into metadata-free WebP sizes (ADR-0009,
 * ADR-0013). The input is untrusted: its real type is read from its bytes,
 * and size, pixel count and width are checked before any resizing.
 */

export type InvalidImageReason =
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'TYPE_MISMATCH'
  | 'TOO_SMALL'
  | 'UNREADABLE';

/** A photo that can't be used. `message` is safe to log; it holds no input data. */
export class InvalidImageError extends Error {
  constructor(readonly reason: InvalidImageReason) {
    super(`Invalid image: ${reason}`);
    this.name = 'InvalidImageError';
  }
}

export interface ImageRules {
  /** The type the uploader declared (and storage enforced). */
  declaredType: string;
  /** MIME types accepted, e.g. `PHOTO_CONTENT_TYPES`. */
  allowedTypes: readonly string[];
  maxBytes: number;
  /** Decoded pixels; guards against tiny files that expand enormously. */
  maxPixels: number;
  /** Narrower (after orientation) is rejected. */
  minWidth: number;
  /** Output sizes by name, e.g. `{ small: 320, medium: 800, large: 1600 }`. */
  widths: Record<string, number>;
}

export interface ProcessedImage {
  /** The real type of the input. */
  sourceType: string;
  /** WebP per size name; never wider than the original. */
  sizes: Record<string, Buffer>;
}

/** The MIME type of what sharp decoded, or null for anything we don't accept. */
function realType(meta: Metadata): string | null {
  switch (meta.format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'tiff':
      return 'image/tiff';
    // AVIF is HEIF with AV1 compression; HEIC (HEVC) can't be decoded.
    case 'heif':
      return meta.compression === 'av1' ? 'image/avif' : null;
    default:
      // Includes svg: never a photo.
      return null;
  }
}

export async function processImage(
  input: Buffer,
  rules: ImageRules,
): Promise<ProcessedImage> {
  if (input.length > rules.maxBytes) throw new InvalidImageError('TOO_LARGE');

  // First frame/page only (GIF, TIFF); `failOn: 'error'` rejects broken files.
  const open = () =>
    sharp(input, {
      limitInputPixels: rules.maxPixels,
      failOn: 'error',
      pages: 1,
    });

  // Only the header is read here (no pixels are decoded), so the pixel limit
  // is checked explicitly below; decoding later is limited by `open()`.
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: false, pages: 1 }).metadata();
  } catch {
    throw new InvalidImageError('UNREADABLE');
  }

  const type = realType(meta);
  if (!type || !rules.allowedTypes.includes(type)) {
    throw new InvalidImageError('UNSUPPORTED_TYPE');
  }
  if (type !== rules.declaredType) {
    throw new InvalidImageError('TYPE_MISMATCH');
  }
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (width * height > rules.maxPixels) {
    throw new InvalidImageError('TOO_LARGE');
  }
  // EXIF orientations 5-8 turn the picture by 90°.
  const shownWidth = (meta.orientation ?? 1) >= 5 ? height : width;
  if (shownWidth < rules.minWidth) throw new InvalidImageError('TOO_SMALL');

  const sizes: Record<string, Buffer> = {};
  try {
    for (const [name, target] of Object.entries(rules.widths)) {
      // sharp writes no metadata unless asked (no withMetadata/keepExif/
      // keepIccProfile/withXmp here): EXIF, GPS, XMP, IPTC and ICC are all
      // dropped. rotate() applies the EXIF orientation first.
      sizes[name] = await open()
        .rotate()
        .resize({ width: target, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    }
  } catch {
    throw new InvalidImageError('UNREADABLE');
  }
  return { sourceType: type, sizes };
}
