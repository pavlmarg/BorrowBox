import {
  CdkDrag,
  CdkDragPlaceholder,
  CdkDropList,
  moveItemInArray,
  type CdkDragDrop,
} from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslocoDirective } from '@jsverse/transloco';
import { ITEM_PHOTOS_MAX } from '@borrowbox/contracts';
import type { PhotoViewResponse } from '../../api/models';
import { NavIcon } from '../../core/layout/nav-icon';
import { ListingStore } from './listing.store';

/**
 * Step 4: the item's photos (ADR-0009, ADR-0013). With a mouse, drop files
 * on the drop area or choose them; on phones, the round camera button opens
 * the rear camera and "Choose photos" the gallery. Photos are converted in
 * the browser, uploaded straight to storage, then processed by Catalog.
 * Drag the tiles to reorder; the first is the cover.
 */
@Component({
  selector: 'bb-photos-step',
  imports: [
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    MatButtonModule,
    MatProgressBarModule,
    NavIcon,
    TranslocoDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *transloco="let t">
      <p class="intro">{{ t('listing.photosIntro', { max: max }) }}</p>

      @if (touch) {
        <!-- Phones: the camera, and the gallery. -->
        <div class="pick">
          <button
            type="button"
            class="camera"
            [disabled]="store.photoSlotsLeft() <= 0"
            [attr.aria-label]="t('listing.takePhoto')"
            (click)="camera.click()"
          >
            <bb-nav-icon name="camera" />
          </button>
          <button
            mat-stroked-button
            type="button"
            [disabled]="store.photoSlotsLeft() <= 0"
            (click)="gallery.click()"
          >
            {{ t('listing.choosePhotos') }}
          </button>
        </div>
      } @else {
        <!-- With a mouse: drop files here, or choose them. -->
        <div
          class="drop"
          [class.over]="dragOver()"
          [class.full]="store.photoSlotsLeft() <= 0"
          (dragenter)="onDragEnter($event)"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave()"
          (drop)="onDrop($event)"
        >
          <bb-nav-icon name="upload" class="drop-icon" />
          <p class="drop-text">
            {{ t(dragOver() ? 'listing.dropRelease' : 'listing.dropPhotos') }}
          </p>
          <p class="drop-or">{{ t('listing.dropOr') }}</p>
          <button
            mat-stroked-button
            type="button"
            class="choose"
            [disabled]="store.photoSlotsLeft() <= 0"
            (click)="gallery.click()"
          >
            {{ t('listing.choosePhotos') }}
          </button>
        </div>
      }
      <div class="inputs">
        <input
          #camera
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          (change)="picked(camera)"
        />
        <input
          #gallery
          hidden
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          (change)="picked(gallery)"
        />
      </div>
      @if (skipped() > 0) {
        <p class="note" role="status">
          {{ t('listing.photosSkipped', { count: skipped(), max: max }) }}
        </p>
      }

      <div
        class="grid"
        cdkDropList
        cdkDropListOrientation="mixed"
        (cdkDropListDropped)="dropped($event)"
      >
        @for (
          photo of store.sortedPhotos();
          track photo.id;
          let first = $first
        ) {
          <div class="tile" cdkDrag [cdkDragData]="photo">
            <div class="tile-placeholder" *cdkDragPlaceholder></div>
            @switch (photo.status) {
              @case ('READY') {
                <img [src]="photo.urls?.small" alt="" />
                @if (first) {
                  <span class="badge">{{ t('listing.cover') }}</span>
                }
              }
              @case ('PENDING') {
                <span class="state">{{ t('listing.processing') }}</span>
              }
              @case ('FAILED') {
                <span class="state failed">{{ t('listing.photoFailed') }}</span>
              }
            }
            <button
              type="button"
              class="remove"
              [attr.aria-label]="t('listing.removePhoto')"
              (click)="store.removePhoto(photo.id)"
            >
              <bb-nav-icon name="close" />
            </button>
          </div>
        }
        @for (upload of store.uploads(); track upload.key) {
          <div class="tile upload" [class.failed]="upload.state === 'failed'">
            @switch (upload.state) {
              @case ('uploading') {
                <span class="state">{{ t('listing.uploading') }}</span>
                <mat-progress-bar
                  mode="determinate"
                  [value]="upload.progress * 100"
                />
              }
              @case ('failed') {
                <span class="state failed">
                  {{ problemText(t, upload.problem) }}
                </span>
                <button
                  type="button"
                  class="remove"
                  [attr.aria-label]="t('listing.dismiss')"
                  (click)="store.dismissUpload(upload.key)"
                >
                  <bb-nav-icon name="close" />
                </button>
              }
              @default {
                <span class="state">{{ t('listing.processing') }}</span>
                <mat-progress-bar mode="indeterminate" />
              }
            }
            <span class="name">{{ upload.name }}</span>
          </div>
        }
      </div>
      @if (store.sortedPhotos().length > 1) {
        <p class="note">{{ t('listing.dragToReorder') }}</p>
      }
    </div>
  `,
  styles: `
    .intro,
    .note {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 0 0 12px;
    }
    .pick {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 16px;
    }
    /* Phones: a round black camera button. */
    .camera {
      align-items: center;
      background: #111;
      border: 0;
      border-radius: 50%;
      box-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      height: 64px;
      justify-content: center;
      padding: 0;
      transition: transform var(--bb-fast) var(--bb-ease);
      width: 64px;
    }
    .camera:active:not([disabled]) {
      transform: scale(0.94);
    }
    .camera[disabled] {
      cursor: default;
      opacity: 0.35;
    }
    .camera:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 3px;
    }
    .camera bb-nav-icon {
      --bb-icon-stroke: 1.9;
      height: 30px;
      width: 30px;
    }
    /* With a mouse: a dashed area to drop photos on. */
    .drop {
      align-items: center;
      background: #fff;
      border: 2px dashed rgb(16 58 99 / 0.25);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
      padding: 28px 16px;
      text-align: center;
      transition:
        background-color var(--bb-medium) var(--bb-ease),
        border-color var(--bb-medium) var(--bb-ease);
    }
    .drop.over {
      background: var(--bb-sky-50);
      border-color: var(--bb-sky-700);
    }
    .drop.full {
      opacity: 0.55;
    }
    .drop-icon {
      color: var(--bb-sky-700);
      height: 32px;
      transition: transform var(--bb-medium) var(--bb-ease);
      width: 32px;
    }
    .drop.over .drop-icon {
      transform: translateY(-4px);
    }
    .drop-text {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-large);
      margin: 0;
    }
    .drop-or {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 0 0 4px;
      text-transform: lowercase;
    }
    /* A lighter hover shadow than other outlined buttons get. */
    .drop .choose:not([disabled]):hover {
      box-shadow: var(--bb-shadow-sm);
    }
    .grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      margin-bottom: 8px;
    }
    .tile {
      aspect-ratio: 1;
      background: var(--bb-sky-100);
      cursor: grab;
      overflow: hidden;
      position: relative;
    }
    .tile.upload {
      cursor: default;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 8px;
    }
    .tile img {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .tile-placeholder {
      aspect-ratio: 1;
      background: rgb(16 58 99 / 0.08);
      outline: 2px dashed var(--bb-sky-500);
    }
    .badge {
      background: var(--bb-sky-700);
      color: #fff;
      font: var(--mat-sys-label-small);
      left: 6px;
      padding: 2px 6px;
      position: absolute;
      top: 6px;
    }
    .state {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
      margin-bottom: 8px;
      text-align: center;
    }
    .tile:not(.upload) .state {
      align-items: center;
      display: flex;
      inset: 0;
      justify-content: center;
      padding: 8px;
      position: absolute;
    }
    .state.failed {
      color: var(--mat-sys-error);
    }
    .name {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin-top: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .remove {
      align-items: center;
      background: rgb(255 255 255 / 0.92);
      border: 0;
      border-radius: var(--bb-button-radius);
      cursor: pointer;
      display: flex;
      height: 28px;
      justify-content: center;
      padding: 0;
      position: absolute;
      right: 6px;
      top: 6px;
      width: 28px;
    }
    .remove bb-nav-icon {
      height: 16px;
      width: 16px;
    }
  `,
})
export class PhotosStep {
  protected readonly store = inject(ListingStore);
  protected readonly max = ITEM_PHOTOS_MAX;
  /** Phones and tablets get "Take photo" (rear camera). */
  protected readonly touch =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  protected readonly skipped = signal(0);
  /** Files are being dragged over the drop area. */
  protected readonly dragOver = signal(false);
  /** Enter/leave pairs, so moving over the area's children doesn't flicker. */
  private dragDepth = 0;

  protected picked(input: HTMLInputElement): void {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length > 0) this.skipped.set(this.store.addPhotos(files));
  }

  protected onDragEnter(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragOver.set(true);
  }

  /** Allows the drop (a drop target must cancel dragover). */
  protected onDragOver(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected onDragLeave(): void {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragOver.set(false);
  }

  /** Dropped files go the same way as chosen ones. */
  protected onDrop(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dragOver.set(false);
    if (this.store.photoSlotsLeft() <= 0) return;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) this.skipped.set(this.store.addPhotos(files));
  }

  protected dropped(
    event: CdkDragDrop<unknown, unknown, PhotoViewResponse>,
  ): void {
    if (event.previousIndex === event.currentIndex) return;
    const ids = this.store.sortedPhotos().map((p) => p.id);
    moveItemInArray(ids, event.previousIndex, event.currentIndex);
    void this.store.reorder(ids);
  }

  protected problemText(
    t: (key: string) => string,
    problem: string | null,
  ): string {
    if (!problem) return t('listing.photoFailed');
    return ['unsupported', 'tooSmall', 'tooLarge', 'unreadable'].includes(
      problem,
    )
      ? t('listing.photoErrors.' + problem)
      : t('errors.' + problem);
  }
}

/** A drag of files from the computer, not of a photo tile being reordered. */
function carriesFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files');
}
