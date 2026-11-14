import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthStore } from '../../core/auth/auth.store';
import { ChangePassword } from '../account-emails/change-password';

/**
 * `/settings/password`: changing the password on a page of its own,
 * reached from Settings' "Password" section. Google-only accounts get a
 * link to set one instead.
 */
@Component({
  selector: 'bb-password-page',
  imports: [RouterLink, TranslocoDirective, ChangePassword],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <a class="back bb-text-action-host" routerLink="/settings">
        <span aria-hidden="true">‹</span>
        <span class="bb-text-action">{{ t('payouts.back') }}</span>
      </a>
      <h1 class="page-title">{{ t('accountEmails.password.title') }}</h1>
      <p class="intro">
        {{
          t(
            auth.user()?.hasPassword
              ? 'settings.password.info'
              : 'settings.password.infoNone'
          )
        }}
      </p>
      <bb-change-password />
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      max-width: 640px;
    }
    .back {
      align-items: center;
      color: var(--mat-sys-on-surface-variant);
      display: inline-flex;
      gap: 6px;
      margin-bottom: 12px;
      text-decoration: none;
    }
    .intro {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 24px;
    }
  `,
})
export class PasswordPage {
  protected readonly auth = inject(AuthStore);
}
