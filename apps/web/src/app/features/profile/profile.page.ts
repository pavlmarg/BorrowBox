import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { errorKey, type KnownErrorCode } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { LanguageService } from '../../core/i18n/language';
import { Avatar } from '../../shared/avatar/avatar';
import { VerifyEmailNotice } from '../account-emails/verify-email-notice';
import { ProfileStore } from './profile.store';

/** Problems found in the browser, before anything is uploaded. */
const LOCAL_PROBLEMS = ['unsupported', 'tooSmall', 'tooLarge', 'unreadable'];

/**
 * The user's profile at a glance, with their photo (ADR-0024): change it
 * (cropped to a square, public like the name) or remove it. Editing the
 * rest lives in Settings.
 */
@Component({
  selector: 'bb-profile-page',
  imports: [
    DatePipe,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatProgressSpinnerModule,
    Avatar,
    VerifyEmailNotice,
  ],
  providers: [ProfileStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (auth.user(); as user) {
        <section class="hero">
          <div class="avatar-wrap" [attr.aria-busy]="photoBusy()">
            <bb-avatar
              class="avatar"
              [size]="112"
              [photoUrl]="user.photo?.large ?? null"
            />
            @if (photoBusy()) {
              <div class="photo-busy">
                <mat-spinner diameter="32" />
              </div>
            }
            <button
              type="button"
              class="photo-edit"
              [disabled]="store.photoStep() !== 'idle'"
              [attr.aria-label]="t('profile.photo.change')"
              [title]="t('profile.photo.change')"
              (click)="fileInput.click()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M9 4h6l1.5 2H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5Zm3 4a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"
                />
              </svg>
            </button>
            <input
              #fileInput
              type="file"
              accept="image/*"
              hidden
              (change)="onFile($event)"
            />
          </div>

          <div class="who">
            <h1 class="name">{{ user.displayName }}</h1>
            <p class="email">{{ user.email }}</p>
            <ul class="chips">
              <li class="chip" [class.ok]="user.emailVerified">
                {{
                  t(
                    user.emailVerified
                      ? 'profile.emailVerified'
                      : 'profile.emailNotVerified'
                  )
                }}
              </li>
              @if (user.hasPassword) {
                <li class="chip">{{ t('profile.withPassword') }}</li>
              }
              @for (provider of user.providers; track provider) {
                <li class="chip">{{ t('profile.withGoogle') }}</li>
              }
            </ul>
            <p class="since">
              {{
                t('profile.memberSince', {
                  date:
                    (user.createdAt
                    | date: 'longDate' : undefined : language.formatLocale()),
                })
              }}
            </p>

            @if (photoBusy()) {
              <p class="photo-status" role="status">
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
              <p class="form-error photo-status" role="alert">{{ t(key) }}</p>
            }

            <div class="actions">
              <a mat-stroked-button routerLink="/settings">{{
                t('profile.editProfile')
              }}</a>
              @if (user.photo) {
                <button
                  mat-button
                  type="button"
                  [disabled]="store.photoStep() !== 'idle'"
                  (click)="store.removePhoto()"
                >
                  {{ t('profile.photo.remove') }}
                </button>
              }
            </div>
            <p class="photo-hint">{{ t('profile.photo.hint') }}</p>
          </div>
        </section>
        <bb-verify-email-notice class="verify" />
      }
    </ng-container>
  `,
  styles: `
    .hero {
      align-items: center;
      display: flex;
      gap: 32px;
      padding: 8px 0;
    }
    .avatar-wrap {
      flex: none;
      position: relative;
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
    .photo-edit {
      align-items: center;
      background: var(--mat-sys-primary);
      border: 2px solid rgb(var(--bb-surface-rgb));
      border-radius: 50%;
      bottom: 0;
      color: var(--mat-sys-on-primary);
      cursor: pointer;
      display: flex;
      height: 36px;
      justify-content: center;
      padding: 0;
      position: absolute;
      right: 0;
      transition: filter var(--bb-fast) var(--bb-ease);
      width: 36px;
    }
    .photo-edit:hover:not(:disabled) {
      filter: brightness(1.1);
    }
    .photo-edit:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }
    .photo-edit:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .photo-edit svg {
      fill: currentColor;
      height: 18px;
      width: 18px;
    }
    .who {
      min-width: 0;
    }
    .verify {
      margin-top: 32px;
    }
    .name {
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      margin: 0;
    }
    .email {
      color: var(--mat-sys-on-surface-variant);
      margin: 2px 0 12px;
      overflow-wrap: anywhere;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
    .chip {
      background: var(--bb-sky-50);
      border: 1px solid var(--bb-sky-200);
      border-radius: var(--bb-radius);
      font: var(--mat-sys-label-medium);
      padding: 4px 10px;
    }
    .chip.ok {
      background: var(--bb-success-bg);
      border-color: var(--bb-success-border);
      color: var(--bb-success-strong);
    }
    .since {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 0 0 16px;
    }
    .photo-status {
      font: var(--mat-sys-body-medium);
      margin: 0 0 12px;
    }
    .actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .photo-hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 12px 0 0;
    }

    @media (max-width: 599px) {
      .hero {
        flex-direction: column;
        gap: 20px;
        padding: 24px 20px;
        text-align: center;
      }
      .chips,
      .actions {
        justify-content: center;
      }
    }
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthStore);
  protected readonly language = inject(LanguageService);
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
