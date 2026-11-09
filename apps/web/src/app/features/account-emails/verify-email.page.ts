import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  type OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { Api } from '../../api/api';
import {
  authControllerVerifyEmail,
  meControllerGet,
} from '../../api/functions';
import {
  errorCode,
  errorKey,
  type KnownErrorCode,
} from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { AuthScene } from '../auth/auth-scene';
import { AUTH_LINK_STYLES } from './auth-link.styles';
import { takeLinkToken } from './link-token';
import { VerificationEmailStore } from './verification-email.store';

type View =
  | { kind: 'verifying' }
  | { kind: 'verified' }
  | { kind: 'failed'; code: KnownErrorCode };

/**
 * `/auth/verify-email#t=<token>`, the link in Identity's verification email.
 * Works signed in or out: the token is the proof. Signed in, the app learns
 * at once that the email is now verified.
 */
@Component({
  selector: 'bb-verify-email-page',
  imports: [RouterLink, TranslocoDirective, MatButtonModule, AuthScene],
  providers: [VerificationEmailStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bb-auth-scene video="register" formSide="left">
      <ng-container *transloco="let t">
        @switch (view().kind) {
          @case ('verifying') {
            <div class="result" role="status">
              <svg class="spinner" viewBox="0 0 48 48" aria-hidden="true">
                <circle class="track" cx="24" cy="24" r="20" />
                <circle class="arc" cx="24" cy="24" r="20" />
              </svg>
              <h1 class="title">{{ t('accountEmails.verify.verifying') }}</h1>
              <p class="message">{{ t('accountEmails.verify.wait') }}</p>
            </div>
          }
          @case ('verified') {
            <div class="result" role="status">
              <span class="icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </span>
              <h1 class="title">
                {{
                  t(
                    alreadyVerified()
                      ? 'accountEmails.verify.alreadyTitle'
                      : 'accountEmails.verify.doneTitle'
                  )
                }}
              </h1>
              <p class="message">{{ t('accountEmails.verify.doneText') }}</p>
            </div>
            <div class="actions">
              @if (auth.isAuthenticated()) {
                <a mat-flat-button routerLink="/explore">{{
                  t('accountEmails.toExplore')
                }}</a>
                <a mat-stroked-button routerLink="/profile">{{
                  t('accountEmails.toProfile')
                }}</a>
              } @else {
                <a mat-flat-button routerLink="/auth/login">{{
                  t('accountEmails.toLogin')
                }}</a>
                <a mat-stroked-button routerLink="/explore">{{
                  t('accountEmails.toExplore')
                }}</a>
              }
            </div>
          }
          @case ('failed') {
            @let code = failedCode();
            <div class="result" role="alert">
              <span class="icon bad" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3 2 20h20L12 3Z" />
                  <path d="M12 10v4.5" />
                  <path d="M12 17.25h.01" />
                </svg>
              </span>
              @if (code === 'TOKEN_INVALID' || code === 'TOKEN_EXPIRED') {
                <h1 class="title">
                  {{
                    t(
                      code === 'TOKEN_EXPIRED'
                        ? 'accountEmails.verify.expiredTitle'
                        : 'accountEmails.verify.invalidTitle'
                    )
                  }}
                </h1>
                <p class="message">
                  {{
                    t(
                      code === 'TOKEN_EXPIRED'
                        ? 'accountEmails.verify.expiredText'
                        : 'accountEmails.verify.invalidText'
                    )
                  }}
                </p>
              } @else {
                <h1 class="title">
                  {{ t('accountEmails.verify.failedTitle') }}
                </h1>
                <p class="message">{{ t(errorKey(code)) }}</p>
              }
            </div>

            @if (code === 'TOKEN_INVALID' || code === 'TOKEN_EXPIRED') {
              @if (auth.user(); as user) {
                <div aria-live="polite">
                  @if (sender.status() === 'sent') {
                    <p class="sent">
                      {{
                        t('accountEmails.verify.resent', { email: user.email })
                      }}
                    </p>
                  }
                  @if (sender.error(); as sendCode) {
                    <p class="form-error sent">{{ t(errorKey(sendCode)) }}</p>
                  }
                </div>
                <div class="actions">
                  <button
                    mat-flat-button
                    type="button"
                    [disabled]="sender.status() === 'sending'"
                    (click)="sender.send()"
                  >
                    {{
                      t(
                        sender.status() === 'sent'
                          ? 'accountEmails.sendAgain'
                          : 'accountEmails.verify.resend'
                      )
                    }}
                  </button>
                  <a mat-stroked-button routerLink="/explore">{{
                    t('accountEmails.toExplore')
                  }}</a>
                </div>
              } @else {
                <p class="message">
                  {{ t('accountEmails.verify.signInToResend') }}
                </p>
                <div class="actions">
                  <a
                    mat-flat-button
                    routerLink="/auth/login"
                    [queryParams]="{ returnUrl: '/settings' }"
                    >{{ t('accountEmails.toLogin') }}</a
                  >
                </div>
              }
            } @else {
              <div class="actions">
                @if (token) {
                  <button mat-flat-button type="button" (click)="verify()">
                    {{ t('accountEmails.tryAgain') }}
                  </button>
                }
                <a mat-stroked-button routerLink="/explore">{{
                  t('accountEmails.toExplore')
                }}</a>
              </div>
            }
          }
        }
      </ng-container>
    </bb-auth-scene>
  `,
  styles: AUTH_LINK_STYLES,
})
export class VerifyEmailPage implements OnInit {
  protected readonly auth = inject(AuthStore);
  protected readonly sender = inject(VerificationEmailStore);
  private readonly api = inject(Api);

  /** Taken (and removed from the address bar) as soon as the page opens. */
  protected readonly token = takeLinkToken(inject(DOCUMENT));
  protected readonly view = signal<View>({ kind: 'verifying' });
  /** The link was already used, and the signed-in account is verified. */
  protected readonly alreadyVerified = signal(false);
  protected readonly failedCode = computed(() => {
    const view = this.view();
    return view.kind === 'failed' ? view.code : 'UNKNOWN';
  });
  protected readonly errorKey = errorKey;

  async ngOnInit(): Promise<void> {
    await this.auth.init();
    await this.verify();
  }

  protected async verify(): Promise<void> {
    if (!this.token) {
      this.fail('TOKEN_INVALID');
      return;
    }
    this.view.set({ kind: 'verifying' });
    try {
      await this.api.invoke(authControllerVerifyEmail, {
        body: { token: this.token },
      });
    } catch (err) {
      this.fail(errorCode(err));
      return;
    }
    this.view.set({ kind: 'verified' });
    // Signed in: the profile now says "verified" (Profile, Settings, the
    // notices). The link may be another account's, so ask rather than assume.
    if (this.auth.isAuthenticated()) {
      try {
        this.auth.updateUser(await this.api.invoke(meControllerGet));
      } catch {
        // Settings reloads the profile anyway.
      }
    }
  }

  private fail(code: KnownErrorCode): void {
    // A used link of an account that is verified by now (e.g. clicked twice).
    if (code === 'TOKEN_INVALID' && this.auth.user()?.emailVerified) {
      this.alreadyVerified.set(true);
      this.view.set({ kind: 'verified' });
      return;
    }
    this.view.set({ kind: 'failed', code });
  }
}
