import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { errorKey, type KnownErrorCode } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { Avatar } from '../../shared/avatar/avatar';
import { openConfirm } from '../../shared/confirm-dialog';
import { ProfileStore } from './profile.store';

/** Problems found in the browser, before anything is uploaded. */
const LOCAL_PROBLEMS = ['unsupported', 'tooSmall', 'tooLarge', 'unreadable'];

/**
 * The profile picture at the top of Settings (ADR-0024): the photo, large,
 * with two small buttons below it, change (cropped to a square, public
 * like the name) and remove (asks first, against misclicks). No hover
 * effects, only a press. Uses the
 * page's ProfileStore; the section heading comes from the page.
 */
@Component({
  selector: 'bb-profile-photo-card',
  imports: [TranslocoDirective, MatProgressSpinnerModule, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <div class="avatar-wrap" [attr.aria-busy]="photoBusy()">
        <bb-avatar
          class="avatar"
          [size]="128"
          [photoUrl]="auth.user()?.photo?.large ?? null"
        />
        @if (photoBusy()) {
          <div class="photo-busy">
            <mat-spinner diameter="36" />
          </div>
        }
      </div>
      <div class="actions">
        <button
          type="button"
          class="pill"
          [disabled]="store.photoStep() !== 'idle'"
          (click)="fileInput.click()"
        >
          {{ t('profile.photo.change') }}
        </button>
        @if (auth.user()?.photo) {
          <button
            type="button"
            class="pill danger"
            [disabled]="store.photoStep() !== 'idle'"
            (click)="confirmRemove()"
          >
            {{ t('profile.photo.remove') }}
          </button>
        }
        <input
          #fileInput
          type="file"
          accept="image/*"
          hidden
          (change)="onFile($event)"
        />
      </div>
      @if (photoBusy()) {
        <p class="status" role="status">
          {{
            t(
              store.photoStep() === 'uploading'
                ? 'profile.photo.uploading'
                : 'profile.photo.processing'
            )
          }}
        </p>
      }
      @if (photoProblemKey(); as key) {
        <p class="form-error status" role="alert">{{ t(key) }}</p>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
    .avatar-wrap {
      position: relative;
      width: 128px;
    }
    .avatar {
      box-shadow: var(--bb-shadow-sm);
    }
    .photo-busy {
      align-items: center;
      background: rgb(var(--bb-surface-rgb) / 0.6);
      border-radius: 50%;
      display: flex;
      inset: 0;
      justify-content: center;
      position: absolute;
    }
    .actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 16px;
    }
    /* Small, flat buttons: no hover effect, only a short press. Change is
       outlined like the page's other buttons; Remove is red text only. */
    .pill {
      align-items: center;
      background: transparent;
      border: 1px solid rgb(var(--bb-line-rgb) / 0.24);
      border-radius: var(--bb-button-radius);
      color: var(--mat-sys-on-surface);
      cursor: pointer;
      display: inline-flex;
      font: var(--mat-sys-label-large);
      height: 32px;
      padding: 0 14px;
      transition: transform 120ms var(--bb-ease);
    }
    .pill:active:not(:disabled) {
      transform: scale(0.94);
    }
    .pill:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .pill:disabled {
      cursor: default;
      opacity: 0.5;
    }
    .pill.danger {
      border-color: transparent;
      color: var(--mat-sys-error);
      padding: 0 10px;
    }
    @media (prefers-reduced-motion: reduce) {
      .pill {
        transition: none;
      }
      .pill:active:not(:disabled) {
        transform: none;
      }
    }
    .status {
      font: var(--mat-sys-body-medium);
      margin: 12px 0 0;
    }
  `,
})
export class ProfilePhotoCard {
  protected readonly auth = inject(AuthStore);
  protected readonly store = inject(ProfileStore);
  private readonly dialog = inject(MatDialog);
  private readonly transloco = inject(TranslocoService);

  /** Removing is easy to hit by mistake: ask first. */
  protected async confirmRemove(): Promise<void> {
    const t = (key: string) => this.transloco.translate(key);
    const confirmed = await openConfirm(this.dialog, {
      title: t('profile.photo.removeTitle'),
      message: t('profile.photo.removeMessage'),
      confirm: t('profile.photo.removeConfirm'),
      cancel: t('profile.photo.removeCancel'),
      danger: true,
    });
    if (confirmed) await this.store.removePhoto();
  }

  /** Uploading, or the server is still processing (also after a reload). */
  protected readonly photoBusy = computed(
    () =>
      this.store.photoStep() === 'uploading' ||
      this.store.photoStep() === 'processing' ||
      (this.store.photoStep() === 'idle' &&
        this.auth.user()?.photoUpload === 'PENDING'),
  );

  /** The message for the last photo problem, or a photo the server refused earlier. */
  protected readonly photoProblemKey = computed((): string | null => {
    const problem = this.store.photoProblem();
    if (problem === 'REJECTED') return 'profile.photo.errors.rejected';
    if (problem && LOCAL_PROBLEMS.includes(problem)) {
      return `profile.photo.errors.${problem}`;
    }
    if (problem) return errorKey(problem as KnownErrorCode);
    return this.auth.user()?.photoUpload === 'FAILED' &&
      this.store.photoStep() === 'idle'
      ? 'profile.photo.errors.rejected'
      : null;
  });

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (file) void this.store.changePhoto(file);
  }
}
