import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
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
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@borrowbox/contracts';
import { errorCode, errorKey } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { safeReturnUrl } from '../../core/auth/return-url';
import { LanguageService, isLanguage } from '../../core/i18n/language';
import { AuthScene } from './auth-scene';
import { GoogleButton } from './google-button';
import { PasswordToggle } from './password-toggle';
import {
  matchesPasswordValidator,
  passwordValidator,
} from './password.validator';

@Component({
  selector: 'bb-register-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    GoogleButton,
    AuthScene,
    PasswordToggle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bb-auth-scene video="register" formSide="left">
      <ng-container *transloco="let t">
        @if (pending()) {
          <mat-progress-bar class="progress" mode="indeterminate" />
        }
        <h1 class="title">{{ t('auth.register.title') }}</h1>
        <p class="subtitle">{{ t('auth.register.subtitle') }}</p>

        <bb-google-button [returnUrl]="returnUrl() ?? null" />
        <p class="divider">{{ t('auth.or') }}</p>

        <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <mat-form-field appearance="outline">
            <mat-label>{{ t('auth.register.displayName') }}</mat-label>
            <input
              matInput
              formControlName="displayName"
              autocomplete="nickname"
              [maxlength]="displayNameMax"
            />
            @if (form.controls.displayName.invalid) {
              <mat-error>{{ t('validation.displayName') }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>{{ t('auth.register.email') }}</mat-label>
            <input
              matInput
              type="email"
              formControlName="email"
              autocomplete="email"
            />
            @if (form.controls.email.hasError('required')) {
              <mat-error>{{ t('validation.required') }}</mat-error>
            } @else if (form.controls.email.invalid) {
              <mat-error>{{ t('validation.email') }}</mat-error>
            }
          </mat-form-field>

          <!-- The hint wraps in Greek; dynamic sizing gives it room. -->
          <mat-form-field
            appearance="outline"
            class="password-field"
            subscriptSizing="dynamic"
          >
            <mat-label>{{ t('auth.register.password') }}</mat-label>
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

          <mat-form-field appearance="outline">
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
            {{ t('auth.register.submit') }}
          </button>
        </form>

        <p class="switch">
          {{ t('auth.register.haveAccount') }}
          <a
            routerLink="/auth/login"
            [queryParams]="{ returnUrl: returnUrl() }"
            >{{ t('auth.register.loginLink') }}</a
          >
        </p>
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
      margin: 4px 0 20px;
    }
    .notice {
      background: var(--bb-sky-100);
      border-radius: 12px;
      margin: 0 0 16px;
      padding: 10px 14px;
    }
    .divider {
      align-items: center;
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      font: var(--mat-sys-label-large);
      gap: 12px;
      margin: 18px 0;
    }
    .divider::before,
    .divider::after {
      background: rgb(16 58 99 / 0.12);
      content: '';
      flex: 1;
      height: 1px;
    }
    .password-field {
      /* Matches the space the other fields reserve under them. */
      margin-bottom: 12px;
    }
    .submit {
      height: 48px;
      margin-top: 4px;
    }
    @media (min-width: 960px) {
      .subtitle {
        margin-bottom: 16px;
      }
      .divider {
        margin: 12px 0;
      }
      .stack {
        gap: 8px;
      }
    }
    /* Short laptop screens: the password rule shows while typing (and as
       the error if it isn't met), so the form fits without scrolling. */
    @media (min-width: 960px) and (max-height: 820px) {
      .subtitle {
        margin-bottom: 12px;
      }
      .divider {
        margin: 8px 0;
      }
      .password-field:not(.mat-focused) mat-hint {
        display: none;
      }
      .password-field:not(.mat-focused) {
        margin-bottom: 20px;
      }
      .submit {
        height: 44px;
      }
      .switch {
        margin-top: 12px;
      }
    }
    .switch {
      margin: 20px 0 0;
      text-align: center;
    }
    .progress {
      border-radius: 4px;
      margin-bottom: 12px;
      overflow: hidden;
    }
  `,
})
export class RegisterPage {
  readonly returnUrl = input<string>();

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly language = inject(LanguageService);

  protected readonly displayNameMax = DISPLAY_NAME_MAX_LENGTH;
  protected readonly passwordMax = PASSWORD_MAX_LENGTH;
  protected readonly form = inject(NonNullableFormBuilder).group({
    displayName: [
      '',
      [
        Validators.required,
        Validators.maxLength(DISPLAY_NAME_MAX_LENGTH),
        Validators.pattern(/\S/),
      ],
    ],
    email: [
      '',
      [
        Validators.required,
        Validators.email,
        Validators.maxLength(EMAIL_MAX_LENGTH),
      ],
    ],
    password: ['', [Validators.required, passwordValidator]],
    confirmPassword: ['', [Validators.required, matchesPasswordValidator]],
  });
  protected readonly pending = signal(false);
  protected readonly error = signal<ReturnType<typeof errorCode> | null>(null);
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
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    const lang = this.language.current();
    // The confirmation is client-side only; the gateway rejects unknown fields.
    const { displayName, email, password } = this.form.getRawValue();
    try {
      await this.auth.register({
        displayName,
        email,
        password,
        // The account starts in the language the user is reading.
        ...(isLanguage(lang) ? { locale: lang } : {}),
      });
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      this.error.set(errorCode(err));
    } finally {
      this.pending.set(false);
    }
  }
}
