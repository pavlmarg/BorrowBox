import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { errorKey } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { VerificationEmailStore } from './verification-email.store';

/**
 * Shown on Profile and Settings while the signed-in user's email isn't
 * verified: what it's for, and a button that sends a new link. Renders
 * nothing once the email is verified.
 */
@Component({
  selector: 'bb-verify-email-notice',
  imports: [TranslocoDirective],
  providers: [VerificationEmailStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.user(); as user) {
      @if (!user.emailVerified) {
        <section
          class="notice"
          aria-labelledby="verify-email-title"
          *transloco="let t"
        >
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
            <path d="m3.5 7 8.5 6.5L20.5 7" />
          </svg>
          <div class="body">
            <h2 class="title" id="verify-email-title">
              {{ t('accountEmails.notice.title') }}
            </h2>
            <p class="text">
              {{ t('accountEmails.notice.text', { email: user.email }) }}
            </p>
            <div class="status" aria-live="polite">
              @if (sender.status() === 'sent') {
                <p class="sent">{{ t('accountEmails.notice.sent') }}</p>
              }
              @if (sender.error(); as code) {
                <p class="form-error">{{ t(errorKey(code)) }}</p>
              }
            </div>
            <button
              type="button"
              class="action bb-text-action"
              [disabled]="sender.status() === 'sending'"
              (click)="sender.send()"
            >
              {{
                t(
                  sender.status() === 'sent'
                    ? 'accountEmails.sendAgain'
                    : 'accountEmails.notice.send'
                )
              }}
            </button>
          </div>
        </section>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .notice {
      display: flex;
      gap: 16px;
      margin: 0 0 32px;
    }
    .icon {
      color: var(--bb-sky-700);
      fill: none;
      flex: none;
      height: 28px;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.6;
      width: 28px;
    }
    .body {
      min-width: 0;
    }
    .title {
      font: var(--mat-sys-title-medium);
      font-weight: 600;
      margin: 2px 0 4px;
    }
    .text {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 8px;
      overflow-wrap: anywhere;
    }
    .sent,
    .form-error {
      margin: 0 0 8px;
    }
    .sent {
      color: var(--mat-sys-on-surface);
      font-weight: 500;
    }
    /* Only the words are a link (the hover is .bb-text-action's). */
    .action {
      background-color: transparent;
      border: 0;
      color: var(--bb-sky-700);
      cursor: pointer;
      font: var(--mat-sys-title-small);
      padding: 0 0 3px;
    }
    .action:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 3px;
    }
    .action[disabled] {
      cursor: default;
      opacity: 0.5;
    }
  `,
})
export class VerifyEmailNotice {
  protected readonly auth = inject(AuthStore);
  protected readonly sender = inject(VerificationEmailStore);
  protected readonly errorKey = errorKey;
}
