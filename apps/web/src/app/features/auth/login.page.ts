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
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { errorCode, errorKey } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { safeReturnUrl } from '../../core/auth/return-url';
import { GoogleButton } from './google-button';

@Component({
  selector: 'bb-login-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    GoogleButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <mat-card appearance="outlined">
        @if (pending()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-content>
          <h1 class="page-title">{{ t('auth.login.title') }}</h1>

          @if (deleted()) {
            <p class="muted" role="status">{{ t('auth.login.deleted') }}</p>
          }

          <form
            class="stack"
            [formGroup]="form"
            (ngSubmit)="submit()"
            novalidate
          >
            <mat-form-field>
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

            <mat-form-field>
              <mat-label>{{ t('auth.login.password') }}</mat-label>
              <input
                matInput
                type="password"
                formControlName="password"
                autocomplete="current-password"
              />
              @if (form.controls.password.hasError('required')) {
                <mat-error>{{ t('validation.required') }}</mat-error>
              }
            </mat-form-field>

            @if (error(); as code) {
              <p class="form-error" role="alert">{{ t(errorKey(code)) }}</p>
            }

            <button mat-flat-button type="submit" [disabled]="pending()">
              {{ t('auth.login.submit') }}
            </button>
          </form>

          <p class="muted or">{{ t('auth.or') }}</p>
          <bb-google-button [returnUrl]="returnUrl() ?? null" />

          <p class="switch">
            {{ t('auth.login.noAccount') }}
            <a
              routerLink="/auth/register"
              [queryParams]="{ returnUrl: returnUrl() }"
              >{{ t('auth.login.registerLink') }}</a
            >
          </p>
        </mat-card-content>
      </mat-card>
    </ng-container>
  `,
  styles: `
    .or {
      text-align: center;
    }
    .switch {
      margin: 16px 0 0;
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
