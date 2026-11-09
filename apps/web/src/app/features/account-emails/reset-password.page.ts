import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { PASSWORD_MAX_LENGTH } from '@borrowbox/contracts';
import { Api } from '../../api/api';
import { authControllerResetPassword } from '../../api/functions';
import {
  errorCode,
  errorKey,
  type KnownErrorCode,
} from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { AuthScene } from '../auth/auth-scene';
import { PasswordToggle } from '../auth/password-toggle';
import {
  matchesPasswordValidator,
  passwordValidator,
} from '../auth/password.validator';
import { AUTH_LINK_STYLES } from './auth-link.styles';
import { takeLinkToken } from './link-token';

/**
 * `/auth/reset-password#t=<token>`, the link in Identity's reset email: sets
 * a new password. Identity then signs out every session and the gateway
 * clears the refresh cookie, so this tab (and the others) sign out too and
 * the user signs in again with the new password.
 */
@Component({
  selector: 'bb-reset-password-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    AuthScene,
    PasswordToggle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bb-auth-scene video="login" formSide="right">
      <ng-container *transloco="let t">
        @if (linkError(); as code) {
          <div class="result" role="alert">
            <span class="icon bad" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3 2 20h20L12 3Z" />
                <path d="M12 10v4.5" />
                <path d="M12 17.25h.01" />
              </svg>
            </span>
            <h1 class="title">
              {{
                t(
                  code === 'TOKEN_EXPIRED'
                    ? 'accountEmails.reset.expiredTitle'
                    : 'accountEmails.reset.invalidTitle'
                )
              }}
            </h1>
            <p class="message">
              {{
                t(
                  code === 'TOKEN_EXPIRED'
                    ? 'accountEmails.reset.expiredText'
                    : 'accountEmails.reset.invalidText'
                )
              }}
            </p>
          </div>
          <div class="actions">
            <a mat-flat-button routerLink="/auth/forgot-password">{{
              t('accountEmails.reset.newLink')
            }}</a>
            <a mat-stroked-button routerLink="/auth/login">{{
              t('accountEmails.backToLogin')
            }}</a>
          </div>
        } @else {
          @if (pending()) {
            <mat-progress-bar class="progress" mode="indeterminate" />
          }
          <h1 class="title">{{ t('accountEmails.reset.title') }}</h1>
          <p class="subtitle">{{ t('accountEmails.reset.subtitle') }}</p>

          <form
            class="stack"
            [formGroup]="form"
            (ngSubmit)="submit()"
            novalidate
          >
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>{{ t('accountEmails.newPassword') }}</mat-label>
              <input
                #passwordInput
                matInput
                type="password"
                formControlName="password"
                autocomplete="new-password"
                [maxlength]="passwordMax"
              />
              <bb-password-toggle matSuffix [target]="passwordInput" />
              <mat-hint>{{ t('auth.register.passwordHint') }}</mat-hint>
              @if (form.controls.password.hasError('required')) {
                <mat-error>{{ t('validation.required') }}</mat-error>
              } @else if (form.controls.password.invalid) {
                <mat-error>{{ t('validation.password') }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="confirm">
              <mat-label>{{ t('auth.register.confirmPassword') }}</mat-label>
              <input
                #confirmInput
                matInput
                type="password"
                formControlName="confirmPassword"
                autocomplete="new-password"
                [maxlength]="passwordMax"
              />
              <bb-password-toggle matSuffix [target]="confirmInput" />
              @if (form.controls.confirmPassword.hasError('required')) {
                <mat-error>{{ t('validation.required') }}</mat-error>
              } @else if (form.controls.confirmPassword.invalid) {
                <mat-error>{{ t('validation.passwordMismatch') }}</mat-error>
              }
            </mat-form-field>

            @if (error(); as code) {
              <p class="form-error" role="alert">{{ t(errorKey(code)) }}</p>
            }

            <button
              mat-flat-button
              class="submit"
              type="submit"
              [disabled]="pending()"
            >
              {{ t('accountEmails.reset.submit') }}
            </button>
          </form>
        }
      </ng-container>
    </bb-auth-scene>
  `,
  styles: [
    AUTH_LINK_STYLES,
    `
      .confirm {
        margin-top: 12px;
      }
    `,
  ],
})
export class ResetPasswordPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  /** Taken (and removed from the address bar) as soon as the page opens. */
  private readonly token = takeLinkToken(inject(DOCUMENT));

  protected readonly passwordMax = PASSWORD_MAX_LENGTH;
  protected readonly form = inject(NonNullableFormBuilder).group({
    password: ['', [Validators.required, passwordValidator]],
    confirmPassword: ['', [Validators.required, matchesPasswordValidator]],
  });
  protected readonly pending = signal(false);
  /** The link itself doesn't work: no point showing the form. */
  protected readonly linkError = signal<KnownErrorCode | null>(
    this.token ? null : 'TOKEN_INVALID',
  );
  protected readonly error = signal<KnownErrorCode | null>(null);
  protected readonly errorKey = errorKey;

  constructor() {
    // Editing the password re-checks the confirmation.
    this.form.controls.password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() =>
        this.form.controls.confirmPassword.updateValueAndValidity(),
      );
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || !this.token) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    try {
      await this.api.invoke(authControllerResetPassword, {
        body: {
          token: this.token,
          newPassword: this.form.getRawValue().password,
        },
      });
    } catch (err) {
      const code = errorCode(err);
      if (code === 'TOKEN_INVALID' || code === 'TOKEN_EXPIRED') {
        this.linkError.set(code);
      } else {
        this.error.set(code);
      }
      this.pending.set(false);
      return;
    }
    // Every session is gone server-side: forget this one here and in the
    // other tabs, then sign in with the new password.
    this.auth.signedOut();
    await this.router.navigate(['/auth/login'], {
      queryParams: { reset: 1 },
      replaceUrl: true,
    });
  }
}
