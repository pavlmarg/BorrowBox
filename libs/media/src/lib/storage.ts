import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Object storage settings: SeaweedFS locally, Cloudflare R2 in production. */
export interface StorageSettings {
  /** e.g. `http://localhost:8333`; omit for AWS itself. */
  endpoint?: string;
  /** `us-east-1` for SeaweedFS, `auto` for R2. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * An S3 client for SeaweedFS / R2. Two settings matter (found in Phase 2,
 * step 4):
 * - path-style URLs (`<endpoint>/<bucket>/<key>`), which both support;
 * - checksums only when an operation requires them. Otherwise the SDK signs
 *   a checksum of an empty body into presigned URLs, and every real browser
 *   upload fails.
 */
export function createStorageClient(settings: StorageSettings): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export interface PresignedUpload {
  url: string;
  /** Headers the upload must send exactly (the signed Content-Type). */
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * A presigned `PUT` for one object. The Content-Type is signed, so storage
 * rejects an upload of any other type (ADR-0009).
 */
export async function presignUpload(
  client: S3Client,
  target: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds: number;
  },
  now: Date = new Date(),
): Promise<PresignedUpload> {
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: target.key,
      ContentType: target.contentType,
    }),
    {
      expiresIn: target.expiresInSeconds,
      signableHeaders: new Set(['content-type']),
      signingDate: now,
    },
  );
  return {
    url,
    headers: { 'Content-Type': target.contentType },
    expiresAt: new Date(now.getTime() + target.expiresInSeconds * 1000),
  };
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof S3ServiceException &&
    (err.name === 'NotFound' ||
      err.name === 'NoSuchKey' ||
      err.$metadata?.httpStatusCode === 404)
  );
}

/** The object's size, or null if there is no such object. */
export async function objectSize(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<number | null> {
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return head.ContentLength ?? 0;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export class ObjectTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Object is larger than ${maxBytes} bytes`);
    this.name = 'ObjectTooLargeError';
  }
}

/**
 * Downloads an object into memory, refusing anything over `maxBytes`
 * without reading the rest. Null if there is no such object.
 */
export async function readObject(
  client: S3Client,
  bucket: string,
  key: string,
  maxBytes: number,
): Promise<Buffer | null> {
  let response;
  try {
    response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  const body = response.Body as AsyncIterable<Uint8Array> | undefined;
  if (!body) return Buffer.alloc(0);
  if ((response.ContentLength ?? 0) > maxBytes) {
    await destroy(body);
    throw new ObjectTooLargeError(maxBytes);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > maxBytes) {
      await destroy(body);
      throw new ObjectTooLargeError(maxBytes);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function destroy(body: AsyncIterable<Uint8Array>): Promise<void> {
  const stream = body as { destroy?: () => void };
  stream.destroy?.();
}

export async function writeObject(
  client: S3Client,
  target: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
    /** e.g. `public, max-age=31536000, immutable` for never-reused keys. */
    cacheControl?: string;
  },
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: target.key,
      Body: target.body,
      ContentType: target.contentType,
      CacheControl: target.cacheControl,
    }),
  );
}

/** Deletes objects one by one; a missing object counts as deleted. */
export async function deleteObjects(
  client: S3Client,
  bucket: string,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
}
