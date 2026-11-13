import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoDirective } from '@jsverse/transloco';
import { errorKey, type KnownErrorCode } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { Avatar } from '../../shared/avatar/avatar';
import { ProfileStore } from './profile.store';

/** Problems found in the browser, before anything is uploaded. */
const LOCAL_PROBLEMS = ['unsupported', 'tooSmall', 'tooLarge', 'unreadable'];

/**
 * Settings' "Profile picture" card (ADR-0024): change the photo (cropped to
 * a square, public like the name) or remove it. Uses the page's ProfileStore.
 */
@Component({
  selector: 'bb-profile-photo-card',
  imports: [
    TranslocoDirective,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    Avatar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-card-title>{{ t('profile.photo.title') }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="row">
            <div class="avatar-wrap" [attr.aria-busy]="photoBusy()">
              <bb-avatar
                [size]="88"
                [photoUrl]="auth.user()?.photo?.large ?? null"
              />
              @if (photoBusy()) {
                <div class="photo-busy">
                  <mat-spinner diameter="28" />
                </div>
              }
            </div>
            <div class="side">
              <div class="actions">
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="store.photoStep() !== 'idle'"
                  (click)="fileInput.click()"
                >
                  {{ t('profile.photo.change') }}
                </button>
                @if (auth.user()?.photo) {
                  <button
                    mat-button
                    type="button"
                    [disabled]="store.photoStep() !== 'idle'"
                    (click)="store.removePhoto()"
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
              <p class="hint">{{ t('profile.photo.hint') }}</p>
            </div>
          </div>
        </mat-card-content>
      </mat-card>
    </ng-container>
  `,
  styles: `
    .row {
      align-items: center;
      display: flex;
      gap: 24px;
    }
    .avatar-wrap {
      flex: none;
      position: relative;
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
    .side {
      min-width: 0;
    }
    .actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .status {
      font: var(--mat-sys-body-medium);
      margin: 12px 0 0;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 12px 0 0;
    }
    /* The cards have no panel, so their content lines up with the title. */
    mat-card-header,
    mat-card-content {
      padding-inline: 0;
    }

    @media (max-width: 599px) {
      .row {
        align-items: flex-start;
        flex-direction: column;
        gap: 16px;
      }
    }
  `,
})
export class ProfilePhotoCard {
  protected readonly auth = inject(AuthStore);
  protected readonly store = inject(ProfileStore);

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
