import {
  PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MIN_PX,
  type PhotoContentType,
} from '@borrowbox/contracts';
import {
  planUndecodable,
  type PhotoProblem,
  type PreparedPhoto,
} from '../listing/photo-prep';

/** Profile photos are sent at most this big; the largest size shown is 512 px. */
export const PROFILE_PHOTO_CLIENT_EDGE_PX = 1024;
const JPEG_QUALITY = 0.86;

/**
 * The centred square of a `width × height` picture, and the edge it's drawn
 * at: the shorter side, capped at `maxEdge`. Never enlarged.
 */
export function squareCrop(
  width: number,
  height: number,
  maxEdge = PROFILE_PHOTO_CLIENT_EDGE_PX,
): { sx: number; sy: number; side: number; edge: number } {
  const side = Math.min(width, height);
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
    edge: Math.min(side, maxEdge),
  };
}

/** The server refuses photos whose shorter side is below the minimum. */
export function checkProfileDecoded(
  width: number,
  height: number,
): PhotoProblem | null {
  return Math.min(width, height) < PROFILE_PHOTO_MIN_PX ? 'tooSmall' : null;
}

/**
 * Crops a chosen photo to its centred square and re-encodes it as a JPEG at
 * most 1024 px, the right way up (ADR-0024). Files the browser can't decode
 * (HEIC outside Safari) go as they are when the server accepts their type:
 * it crops them itself. A convenience only: the server strips metadata and
 * checks everything again.
 */
export async function prepareProfilePhoto(file: File): Promise<PreparedPhoto> {
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
    const problem = checkProfileDecoded(bitmap.width, bitmap.height);
    if (problem) return { ok: false, problem };
    const { sx, sy, side, edge } = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext('2d');
    if (!context) return { ok: false, problem: 'unreadable' };
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, edge, edge);
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
