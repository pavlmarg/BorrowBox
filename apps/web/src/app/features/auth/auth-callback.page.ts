import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
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
    MatProgressBarModule,
    AuthScene,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bb-auth-scene video="register" formSide="left">
      <div *transloco="let t">
        @if (failure(); as code) {
          <div class="stack">
            <h1 class="page-title">{{ t('auth.callback.failed') }}</h1>
            <p class="form-error" role="alert">{{ t(errorKey(code)) }}</p>
            <a mat-flat-button routerLink="/auth/login">{{
              t('auth.callback.backToLogin')
            }}</a>
          </div>
        } @else {
          <mat-progress-bar mode="indeterminate" />
          <div>
            <p role="status">{{ t('auth.callback.working') }}</p>
          </div>
        }
      </div>
    </bb-auth-scene>
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
