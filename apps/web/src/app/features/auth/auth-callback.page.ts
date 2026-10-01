import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  errorKey,
  knownCodeOr,
  type KnownErrorCode,
} from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { takeReturnUrl } from '../../core/auth/return-url';
import { AuthScene } from './auth-scene';
import { GoogleButton } from './google-button';

/**
 * Where the gateway sends the browser after Google. The refresh cookie is
 * already set; the app-initialiser's refresh has turned it into a session.
 */
@Component({
  selector: 'bb-auth-callback-page',
  imports: [
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    AuthScene,
    GoogleButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bb-auth-scene video="register" formSide="left">
      <ng-container *transloco="let t">
        @if (failure(); as code) {
          <div class="failure" role="alert">
            <span class="icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path
                  d="M12 3 2 20h20L12 3Z"
                  fill="none"
                  stroke="currentColor"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                />
                <path
                  d="M12 10v4.5"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-width="1.8"
                />
                <circle cx="12" cy="17.25" r="1.1" fill="currentColor" />
              </svg>
            </span>
            <h1 class="title">{{ t('auth.callback.failed') }}</h1>
            <p class="message">{{ t(errorKey(code)) }}</p>
          </div>
          <div class="actions">
            <bb-google-button label="auth.callback.tryAgain" />
            <a mat-flat-button class="back" routerLink="/auth/login">{{
              t('auth.callback.backToLogin')
            }}</a>
          </div>
        } @else {
          <div class="working" role="status">
            <svg class="spinner" viewBox="0 0 48 48" aria-hidden="true">
              <circle class="track" cx="24" cy="24" r="20" />
              <circle class="arc" cx="24" cy="24" r="20" />
            </svg>
            <h1 class="title">{{ t('auth.callback.title') }}</h1>
            <p class="subtitle">{{ t('auth.callback.working') }}</p>
            <p class="hint">{{ t('auth.callback.hint') }}</p>
          </div>
        }
      </ng-container>
    </bb-auth-scene>
  `,
  styles: `
    .title {
      font: var(--mat-sys-headline-small);
      font-weight: 600;
      margin: 0;
    }
    .subtitle {
      color: var(--mat-sys-on-surface-variant);
      margin: 4px 0 0;
    }

    .working {
      animation: rise var(--bb-fade) var(--bb-ease) both;
    }
    .spinner {
      animation: spin 1.1s linear infinite;
      display: block;
      height: 48px;
      margin-bottom: 20px;
      width: 48px;
    }
    .spinner circle {
      fill: none;
      stroke-width: 4;
    }
    .track {
      stroke: var(--bb-sky-200);
    }
    .arc {
      stroke: var(--bb-sky-700);
      stroke-dasharray: 32 126;
      stroke-linecap: round;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 16px 0 0;
    }

    .failure {
      animation: rise var(--bb-fade) var(--bb-ease) both;
      background: var(--bb-card-bg);
      border: 1px solid rgb(186 26 26 / 0.18);
      border-radius: var(--bb-radius);
      box-shadow: var(--bb-shadow-sm);
      padding: 20px;
    }
    .icon {
      align-items: center;
      background: rgb(186 26 26 / 0.08);
      border-radius: 50%;
      color: var(--mat-sys-error);
      display: inline-flex;
      height: 44px;
      justify-content: center;
      margin-bottom: 12px;
      width: 44px;
    }
    .icon svg {
      height: 24px;
      width: 24px;
    }
    .message {
      color: var(--mat-sys-on-surface-variant);
      margin: 6px 0 0;
    }
    .actions {
      display: grid;
      gap: 12px;
      margin-top: 20px;
    }
    .back {
      height: 48px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner,
      .working,
      .failure {
        animation: none;
      }
    }
  `,
})
export class AuthCallbackPage implements OnInit {
  /** `?error=` from the gateway. */
  readonly error = input<string>();

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly failure = signal<KnownErrorCode | null>(null);
  protected readonly errorKey = errorKey;

  async ngOnInit(): Promise<void> {
    const returnUrl = takeReturnUrl();
    if (this.error()) {
      this.failure.set(
        knownCodeOr(this.error() ?? null, 'OAUTH_EXCHANGE_FAILED'),
      );
      return;
    }
    await this.auth.init();
    if (!this.auth.isAuthenticated()) await this.auth.refresh();
    if (this.auth.isAuthenticated()) {
      await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
    } else {
      this.failure.set('OAUTH_EXCHANGE_FAILED');
    }
  }
}
