/**
 * Gateway → Catalog request/response contracts (NestJS TCP, ADR-0005).
 *
 * Plain types only: requests are validated with class-validator in the
 * gateway (HTTP) and again in Catalog (RPC). The caller is identified from
 * `RpcRequest.accessToken`, never from ids in `data`; ownership is checked
 * inside Catalog.
 */
import type { ItemCategory } from './categories';
import type {
  GeoPoint,
  ItemPricing,
  OwnItem,
  PhotoView,
  PublicItemDetail,
  SearchItemsRequest,
  SearchItemsResponse,
} from './items';
import type { PhotoContentType } from './validation';

/** Carried in `RpcErrorBody.code` (see `../rpc/rpc.ts`). */
export type CatalogErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  /**
   * Unknown item or photo, and also someone else's item where only its owner
   * may act (or a draft), so we never confirm that it exists.
   */
  | 'NOT_FOUND'
  /** Publishing needs a location and at least one processed photo. */
  | 'NOT_PUBLISHABLE'
  /** The item already has the maximum number of photos. */
  | 'PHOTO_LIMIT_REACHED'
  /** The action doesn't fit the item's status, e.g. pausing a draft. */
  | 'INVALID_STATE'
  /** Unexpected failure; details are only in Catalog's logs. */
  | 'INTERNAL';

// --- Requests ---------------------------------------------------------------

export interface ItemRef {
  itemId: string;
}

export interface CreateItemRequest {
  title: string;
  /** Defaults to an empty description. */
  description?: string;
  category: ItemCategory;
  pricing: ItemPricing;
  depositCents: number;
}

/** Only the fields present change. */
export interface UpdateItemRequest extends ItemRef {
  title?: string;
  description?: string;
  category?: ItemCategory;
  pricing?: ItemPricing;
  depositCents?: number;
}

/** The exact point the lender dropped; Catalog derives the fuzzed one (ADR-0007). */
export interface SetItemLocationRequest extends ItemRef {
  location: GeoPoint;
}

export interface CreatePhotoUploadRequest extends ItemRef {
  contentType: PhotoContentType;
  sizeBytes: number;
}

/** Where the browser uploads the file (ADR-0009). */
export interface PhotoUpload {
  photoId: string;
  /** Presigned `PUT` URL; valid until `expiresAt`. */
  uploadUrl: string;
  /** Headers the upload must send exactly (e.g. Content-Type). */
  uploadHeaders: Record<string, string>;
  /** ISO-8601. */
  expiresAt: string;
}

export interface PhotoRef extends ItemRef {
  photoId: string;
}

/** Every photo of the item, in the new order. */
export interface ReorderPhotosRequest extends ItemRef {
  photoIds: string[];
}

/** Catalog's part of `GET /me/export`: the caller's own items, exact location included. */
export interface CatalogDataExport {
  exportedAt: string;
  items: OwnItem[];
}

// --- Patterns ---------------------------------------------------------------

export const CatalogRpc = {
  // Public (no token needed).
  search: 'catalog.items.search',
  getPublic: 'catalog.items.public.get',
  // The caller's own items.
  create: 'catalog.items.create',
  update: 'catalog.items.update',
  setLocation: 'catalog.items.location.set',
  publish: 'catalog.items.publish',
  pause: 'catalog.items.pause',
  unpause: 'catalog.items.unpause',
  delete: 'catalog.items.delete',
  getOwn: 'catalog.items.own.get',
  listMine: 'catalog.items.own.list',
  // Photos of the caller's own items.
  createPhotoUpload: 'catalog.photos.upload.create',
  confirmPhoto: 'catalog.photos.confirm',
  deletePhoto: 'catalog.photos.delete',
  reorderPhotos: 'catalog.photos.reorder',
  // GDPR.
  exportMe: 'catalog.me.export',
} as const;

/** Pattern → request/response types, for typed clients and handlers. */
export interface CatalogRpcContract {
  [CatalogRpc.search]: {
    request: SearchItemsRequest;
    response: SearchItemsResponse;
  };
  [CatalogRpc.getPublic]: { request: ItemRef; response: PublicItemDetail };
  [CatalogRpc.create]: { request: CreateItemRequest; response: OwnItem };
  [CatalogRpc.update]: { request: UpdateItemRequest; response: OwnItem };
  [CatalogRpc.setLocation]: {
    request: SetItemLocationRequest;
    response: OwnItem;
  };
  [CatalogRpc.publish]: { request: ItemRef; response: OwnItem };
  [CatalogRpc.pause]: { request: ItemRef; response: OwnItem };
  [CatalogRpc.unpause]: { request: ItemRef; response: OwnItem };
  [CatalogRpc.delete]: { request: ItemRef; response: void };
  [CatalogRpc.getOwn]: { request: ItemRef; response: OwnItem };
  [CatalogRpc.listMine]: {
    request: Record<string, never>;
    response: OwnItem[];
  };
  [CatalogRpc.createPhotoUpload]: {
    request: CreatePhotoUploadRequest;
    response: PhotoUpload;
  };
  [CatalogRpc.confirmPhoto]: { request: PhotoRef; response: PhotoView };
  [CatalogRpc.deletePhoto]: { request: PhotoRef; response: void };
  [CatalogRpc.reorderPhotos]: {
    request: ReorderPhotosRequest;
    response: PhotoView[];
  };
  [CatalogRpc.exportMe]: {
    request: Record<string, never>;
    response: CatalogDataExport;
  };
}

export type CatalogRpcPattern = keyof CatalogRpcContract;
