import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthStore } from '../../core/auth/auth.store';
import { LanguageService } from '../../core/i18n/language';

/** Up to two letters for the avatar: first and last word of the name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0];
  const last = words.length > 1 ? [...words[words.length - 1]][0] : '';
  return (first + last).toLocaleUpperCase();
}

/**
 * The user's profile at a glance. Editing lives in Settings; the photo,
 * items and rentals arrive with later phases.
 */
@Component({
  selector: 'bb-profile-page',
  imports: [DatePipe, RouterLink, TranslocoDirective, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (auth.user(); as user) {
        <section class="hero">
          <div class="avatar-wrap">
            <div class="avatar" aria-hidden="true">{{ avatar() }}</div>
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
      background: var(--bb-card-bg);
      border: 1px solid var(--bb-card-border);
      border-radius: var(--bb-radius);
      box-shadow: var(--bb-shadow-sm);
      display: flex;
      gap: 32px;
      padding: 32px;
    }
    .avatar-wrap {
      flex: none;
      position: relative;
    }
    .avatar {
      align-items: center;
      background: linear-gradient(
        135deg,
        var(--bb-sky-300) 0%,
        var(--bb-sky-700) 100%
      );
      border-radius: 50%;
      box-shadow: var(--bb-shadow-md);
      color: #fff;
      display: flex;
      font-size: 40px;
      font-weight: 700;
      height: 112px;
      justify-content: center;
      letter-spacing: 1px;
      width: 112px;
    }
    .photo-soon {
      background: var(--bb-sky-100);
      border: 2px solid #fff;
      border-radius: 999px;
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
      border-radius: 999px;
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
  protected readonly avatar = computed(() =>
    initials(this.auth.user()?.displayName ?? ''),
  );
}
