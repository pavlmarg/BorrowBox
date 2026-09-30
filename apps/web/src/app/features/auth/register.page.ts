import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
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
import { passwordValidator } from './password.validator';

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

          <mat-form-field appearance="outline">
            <mat-label>{{ t('auth.register.password') }}</mat-label>
            <input
              matInput
              type="password"
              formControlName="password"
              autocomplete="new-password"
              [maxlength]="passwordMax"
            />
            <mat-hint>{{ t('auth.register.passwordHint') }}</mat-hint>
            @if (form.controls.password.hasError('required')) {
              <mat-error>{{ t('validation.required') }}</mat-error>
            } @else if (form.controls.password.invalid) {
              <mat-error>{{ t('validation.password') }}</mat-error>
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
    .submit {
      height: 48px;
      margin-top: 4px;
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
  });
  protected readonly pending = signal(false);
  protected readonly error = signal<ReturnType<typeof errorCode> | null>(null);
  protected readonly errorKey = errorKey;

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    const lang = this.language.current();
    try {
      await this.auth.register({
        ...this.form.getRawValue(),
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
