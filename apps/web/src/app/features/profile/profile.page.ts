import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthStore } from '../../core/auth/auth.store';
import { LanguageService } from '../../core/i18n/language';
import { Avatar } from '../../shared/avatar/avatar';

/**
 * The user's profile at a glance. Editing lives in Settings; the photo,
 * items and rentals arrive with later phases.
 */
@Component({
  selector: 'bb-profile-page',
  imports: [DatePipe, RouterLink, TranslocoDirective, MatButtonModule, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (auth.user(); as user) {
        <section class="hero">
          <div class="avatar-wrap">
            <bb-avatar class="avatar" [size]="112" />
            <span class="photo-soon" [title]="t('profile.changePhoto')">
              {{ t('nav.soon') }}
            </span>
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
            <a mat-stroked-button routerLink="/settings">{{
              t('profile.editProfile')
            }}</a>
          </div>
        </section>
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
    .photo-soon {
      background: var(--bb-sky-100);
      border: 2px solid #fff;
      border-radius: var(--bb-radius);
      bottom: -4px;
      color: var(--bb-sky-700);
      font: var(--mat-sys-label-small);
      left: 50%;
      padding: 2px 8px;
      position: absolute;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    .who {
      min-width: 0;
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
      background: #e8f6ee;
      border-color: #b5e1c6;
      color: #1d6b3f;
    }
    .since {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 0 0 16px;
    }

    @media (max-width: 599px) {
      .hero {
        flex-direction: column;
        gap: 20px;
        padding: 24px 20px;
        text-align: center;
      }
      .chips {
        justify-content: center;
      }
    }
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthStore);
  protected readonly language = inject(LanguageService);
}
