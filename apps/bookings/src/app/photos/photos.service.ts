import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import {
  CONDITION_PHOTOS_MAX_PER_PHASE,
  HANDOFF_PHASES,
  type ConditionPhotoExport,
  type ConditionPhotoUpload,
  type ConditionPhotoView,
  type ConditionPhotosView,
  type HandoffPhase,
} from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import {
  findBooking,
  lockBooking,
  type BookingRow,
} from '../bookings/bookings.repository';
import { findUser } from '../read-models/users.repository';
import { BookingsError } from '../rpc/rpc-errors';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import { photosOpen } from './photo-window';
import type { ConditionPhotoUploadDto } from './photos.dto';
import {
  countPhotos,
  findPhoto,
  insertPhoto,
  listPhotos,
  listPhotosOf,
  lockPhoto,
  markConfirmed,
  removePhoto,
  type PhotoRow,
} from './photos.repository';

const NOT_FOUND = () => new BookingsError('NOT_FOUND', 'Photo not found');
const BOOKING_NOT_FOUND = () =>
  new BookingsError('NOT_FOUND', 'Booking not found');
const CLOSED = () =>
  new BookingsError(
    'INVALID_STATE',
    'Photos of this handoff can no longer be added or removed',
  );

/**
 * Condition photos (ADR-0027): each of the two people may add up to three
 * per handoff while its window is open, and remove their own while it
 * stays open. Only the two see them, through links valid 5 minutes.
 * Commands lock the booking's row first, so the limit holds.
 */
@Injectable()
export class PhotosService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly storage: PhotoStorage,
    private readonly queue: PhotoQueue,
  ) {}

  /**
   * A new photo waiting for its file, and a presigned URL to put it at.
   * Repeating the request (same photo id) returns the same upload.
   */
  async requestUpload(
    user: AuthUser,
    dto: ConditionPhotoUploadDto,
    now = new Date(),
  ): Promise<ConditionPhotoUpload> {
    const { photo, booking } = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const booking = await this.lockAsParty(tx, dto.bookingId, user);
      const existing = await findPhoto(tx, dto.photoId);
      if (existing) {
        if (
          existing.booking_id !== booking.id ||
          existing.uploader_id !== user.userId ||
          existing.phase !== dto.phase
        ) {
          throw new BookingsError(
            'VALIDATION_FAILED',
            'Invalid fields: photoId',
          );
        }
        return { photo: existing, booking };
      }
      if (!photosOpen(booking, dto.phase, now)) throw CLOSED();
      const taken = await countPhotos(tx, booking.id, dto.phase, user.userId);
      if (taken >= CONDITION_PHOTOS_MAX_PER_PHASE) {
        throw new BookingsError(
          'PHOTO_LIMIT_REACHED',
          `Up to ${CONDITION_PHOTOS_MAX_PER_PHASE} photos per handoff`,
        );
      }
      await insertPhoto(tx, {
        id: dto.photoId,
        bookingId: booking.id,
        phase: dto.phase,
        uploaderId: user.userId,
        uploadKey: `incoming/${randomUUID()}`,
        contentType: dto.contentType,
        sizeBytes: dto.sizeBytes,
      });
      return {
        photo: (await findPhoto(tx, dto.photoId)) as PhotoRow,
        booking,
      };
    });
    if (photo.status !== 'PENDING' || photo.confirmed_at) {
      throw new BookingsError(
        'INVALID_STATE',
        'This photo was already uploaded',
      );
    }
    // After the commit: a row exists for every URL ever issued, so the
    // sweeper can always find and remove an abandoned upload.
    const presigned = await this.storage.presignUpload(
      photo.upload_key,
      photo.content_type,
    );
    return {
      photo: await this.toView(photo, booking, user, now),
      uploadUrl: presigned.url,
      uploadHeaders: presigned.headers,
      expiresAt: presigned.expiresAt.toISOString(),
    };
  }

  /**
   * The browser's upload finished: its time becomes the photo's, and it is
   * queued for processing. Repeating it is safe; confirming before the file
   * arrived is refused.
   */
  async confirm(
    user: AuthUser,
    bookingId: string,
    photoId: string,
    now = new Date(),
  ): Promise<ConditionPhotoView> {
    const { photo, booking } = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const booking = await this.lockAsParty(tx, bookingId, user);
      const photo = await lockPhoto(tx, photoId);
      if (
        !photo ||
        photo.booking_id !== booking.id ||
        photo.uploader_id !== user.userId
      ) {
        throw NOT_FOUND();
      }
      if (photo.status === 'PENDING' && !photo.confirmed_at) {
        if ((await this.storage.uploadSize(photo.upload_key)) === null) {
          throw new BookingsError(
            'INVALID_STATE',
            "The photo hasn't been uploaded yet",
          );
        }
        await markConfirmed(tx, photo.id);
      }
      return {
        photo: (await findPhoto(tx, photoId)) as PhotoRow,
        booking,
      };
    });
    if (photo.status === 'PENDING') await this.queue.process(photo.id);
    return this.toView(photo, booking, user, now);
  }

  /** The uploader removes their own photo while the window is still open. */
  async remove(
    user: AuthUser,
    bookingId: string,
    photoId: string,
    now = new Date(),
  ): Promise<void> {
    const removed = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const booking = await this.lockAsParty(tx, bookingId, user);
      const photo = await lockPhoto(tx, photoId);
      if (!photo) return false; // already removed: a repeat
      if (
        photo.booking_id !== booking.id ||
        photo.uploader_id !== user.userId
      ) {
        throw NOT_FOUND();
      }
      if (!photosOpen(booking, photo.phase, now)) throw CLOSED();
      await removePhoto(tx, photo);
      return true;
    });
    if (removed) await this.queue.cleanup();
  }

  /** Both people's photos of the booking, and whether the caller can add more. */
  async list(
    user: AuthUser,
    bookingId: string,
    now = new Date(),
  ): Promise<ConditionPhotosView> {
    const tx = this.dataSource.manager;
    const booking = await findBooking(tx, bookingId);
    if (!booking || !isParty(booking, user)) throw BOOKING_NOT_FOUND();
    const rows = await listPhotos(tx, bookingId);
    const canAdd = {} as Record<HandoffPhase, boolean>;
    for (const phase of HANDOFF_PHASES) {
      const mine = rows.filter(
        (r) =>
          r.phase === phase &&
          r.uploader_id === user.userId &&
          r.status !== 'FAILED',
      ).length;
      canAdd[phase] =
        photosOpen(booking, phase, now) &&
        mine < CONDITION_PHOTOS_MAX_PER_PHASE;
    }
    return {
      photos: await Promise.all(
        rows.map((row) => this.toView(row, booking, user, now)),
      ),
      canAdd,
    };
  }

  /** The caller's own photos, with links, for `GET /me/export`. */
  async exportOf(
    tx: EntityManager,
    userId: string,
    now = new Date(),
  ): Promise<ConditionPhotoExport[]> {
    const rows = await listPhotosOf(tx, userId);
    return Promise.all(
      rows.map(async (row) => ({
        bookingId: row.booking_id,
        phase: row.phase,
        takenAt: row.confirmed_at?.toISOString() ?? null,
        urls: row.file_key
          ? (await this.storage.links(row.file_key, now)).urls
          : null,
      })),
    );
  }

  private async toView(
    row: PhotoRow,
    booking: BookingRow,
    user: AuthUser,
    now: Date,
  ): Promise<ConditionPhotoView> {
    const links =
      row.status === 'READY' && row.file_key
        ? await this.storage.links(row.file_key, now)
        : null;
    return {
      id: row.id,
      phase: row.phase,
      takenBy: row.uploader_id === booking.renter_id ? 'RENTER' : 'LENDER',
      mine: row.uploader_id === user.userId,
      status: row.status,
      takenAt: row.confirmed_at?.toISOString() ?? null,
      urls: links?.urls ?? null,
      urlsExpireAt: links?.expiresAt.toISOString() ?? null,
    };
  }

  private async lockAsParty(
    tx: EntityManager,
    bookingId: string,
    user: AuthUser,
  ): Promise<BookingRow> {
    const booking = await lockBooking(tx, bookingId);
    if (!booking || !isParty(booking, user)) throw BOOKING_NOT_FOUND();
    return booking;
  }

  /** An erased account may not act anymore (tokens outlive it by ≤15 min). */
  private async assertActive(tx: EntityManager, user: AuthUser): Promise<void> {
    if ((await findUser(tx, user.userId))?.deleted_at) {
      throw new BookingsError('UNAUTHENTICATED', 'Authentication required');
    }
  }
}

function isParty(row: BookingRow, user: AuthUser): boolean {
  return row.renter_id === user.userId || row.lender_id === user.userId;
}
