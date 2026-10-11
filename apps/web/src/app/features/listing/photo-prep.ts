import {
  PHOTO_CLIENT_MAX_EDGE_PX,
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_MIN_WIDTH_PX,
  type PhotoContentType,
} from '@borrowbox/contracts';

/** Why a chosen file can't be used; each has a message under `listing.photoErrors.*`. */
export type PhotoProblem =
  'unsupported' | 'tooSmall' | 'tooLarge' | 'unreadable';

export type PreparedPhoto =
  | { ok: true; blob: Blob; contentType: PhotoContentType }
  | { ok: false; problem: PhotoProblem };

/**
 * The size a photo is drawn at: unchanged if it fits, else scaled down so
 * its longer side is `maxEdge`. Never enlarged.
 */
export function scaledSize(
  width: number,
  height: number,
  maxEdge = PHOTO_CLIENT_MAX_EDGE_PX,
): { width: number; height: number } {
  const longer = Math.max(width, height);
  if (longer <= maxEdge) return { width, height };
  const factor = maxEdge / longer;
  return {
    width: Math.round(width * factor),
    height: Math.round(height * factor),
  };
}

export function isAcceptedType(type: string): type is PhotoContentType {
  return (PHOTO_CONTENT_TYPES as readonly string[]).includes(type);
}

/**
 * What to do with a file the browser couldn't decode (ADR-0013): upload it
 * as it is when the server accepts its type (the server decides), else
 * refuse. HEIC outside Safari ends up here.
 */
export function planUndecodable(file: {
  type: string;
  size: number;
}): PreparedPhoto | 'upload-as-is' {
  if (!isAcceptedType(file.type)) return { ok: false, problem: 'unsupported' };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, problem: 'tooLarge' };
  return 'upload-as-is';
}

/** After decoding: the photo must be wide enough to be useful. */
export function checkDecoded(width: number): PhotoProblem | null {
  return width < PHOTO_MIN_WIDTH_PX ? 'tooSmall' : null;
}

const JPEG_QUALITY = 0.86;

/**
 * Re-encodes any photo the browser can display (HEIC too, in Safari) to a
 * JPEG at most 2048 px on its longer side, the right way up (ADR-0013).
 * A convenience only: the server strips metadata and checks everything
 * again; never rely on this for privacy.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const plan = planUndecodable(file);
    return plan === 'upload-as-is'
      ? { ok: true, blob: file, contentType: file.type as PhotoContentType }
      : plan;
  }
  try {
    const problem = checkDecoded(bitmap.width);
    if (problem) return { ok: false, problem };
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return { ok: false, problem: 'unreadable' };
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) return { ok: false, problem: 'unreadable' };
    if (blob.size > PHOTO_MAX_BYTES) return { ok: false, problem: 'tooLarge' };
    return { ok: true, blob, contentType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}
