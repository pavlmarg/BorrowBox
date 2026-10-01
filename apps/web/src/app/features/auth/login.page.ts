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
import { errorCode, errorKey } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { safeReturnUrl } from '../../core/auth/return-url';
import { AuthScene } from './auth-scene';
import { GoogleButton } from './google-button';
import { PasswordToggle } from './password-toggle';

@Component({
  selector: 'bb-login-page',
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
    <bb-auth-scene video="login" formSide="right">
      <ng-container *transloco="let t">
        @if (pending()) {
          <mat-progress-bar class="progress" mode="indeterminate" />
        }
        <h1 class="title">{{ t('auth.login.title') }}</h1>
        <p class="subtitle">{{ t('auth.login.subtitle') }}</p>

        @if (deleted()) {
          <p class="notice" role="status">{{ t('auth.login.deleted') }}</p>
        }

        <bb-google-button [returnUrl]="returnUrl() ?? null" />
        <p class="divider">{{ t('auth.or') }}</p>

        <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <mat-form-field appearance="outline">
            <mat-label>{{ t('auth.login.email') }}</mat-label>
            <input
              matInput
              type="email"
              formControlName="email"
              autocomplete="email"
            />
            @if (form.controls.email.hasError('required')) {
              <mat-error>{{ t('validation.required') }}</mat-error>
            } @else if (form.controls.email.hasError('email')) {
              <mat-error>{{ t('validation.email') }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>{{ t('auth.login.password') }}</mat-label>
            <input
              #passwordInput
              matInput
              type="password"
              formControlName="password"
              autocomplete="current-password"
            />
            <bb-password-toggle matSuffix [target]="passwordInput" />
            @if (form.controls.password.hasError('required')) {
              <mat-error>{{ t('validation.required') }}</mat-error>
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
            {{ t('auth.login.submit') }}
          </button>
        </form>

        <p class="switch">
          {{ t('auth.login.noAccount') }}
          <a
            routerLink="/auth/register"
            [queryParams]="{ returnUrl: returnUrl() }"
            >{{ t('auth.login.registerLink') }}</a
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
export class LoginPage {
  /** Query params (router input binding). */
  readonly returnUrl = input<string>();
  readonly deleted = input<string>();

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
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
    try {
      await this.auth.login(this.form.getRawValue());
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      this.error.set(errorCode(err));
    } finally {
      this.pending.set(false);
    }
  }
}
