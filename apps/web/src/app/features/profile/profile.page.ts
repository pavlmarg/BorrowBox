import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthStore } from '../../core/auth/auth.store';
import { LanguageService } from '../../core/i18n/language';
import { Avatar } from '../../shared/avatar/avatar';
import { VerifyEmailNotice } from '../account-emails/verify-email-notice';

/**
 * The user's profile at a glance, with their photo (ADR-0024). Changing the
 * photo and editing the rest live in Settings.
 */
@Component({
  selector: 'bb-profile-page',
  imports: [
    DatePipe,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    Avatar,
    VerifyEmailNotice,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (auth.user(); as user) {
        <section class="hero">
          <div class="avatar-wrap">
            <bb-avatar
              class="avatar"
              [size]="112"
              [photoUrl]="user.photo?.large ?? null"
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

            <div class="actions">
              <a mat-stroked-button routerLink="/settings">{{
                t('profile.editProfile')
              }}</a>
            </div>
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
    .actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
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
}
