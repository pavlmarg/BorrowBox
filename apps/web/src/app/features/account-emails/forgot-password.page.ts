import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  computed,
  inject,
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
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { EMAIL_MAX_LENGTH } from '@borrowbox/contracts';
import { Api } from '../../api/api';
import { authControllerRequestPasswordReset } from '../../api/functions';
import {
  errorCode,
  errorKey,
  type KnownErrorCode,
} from '../../core/api-errors';
import { emailAddress } from '../../shared/forms/validators';
import { AuthScene } from '../auth/auth-scene';
import { AUTH_LINK_STYLES } from './auth-link.styles';

/** What the login page hands over in the navigation's state (not the URL). */
export interface ForgotPasswordState {
  email?: string;
}

/** Identity sends an account at most one email of a kind a minute. */
export const RESEND_AFTER_MS = 60_000;

/** The address the login page handed over, if it's a string. */
function initialEmail(doc: Document): string {
  const state = doc.defaultView?.history.state as ForgotPasswordState | null;
  return typeof state?.email === 'string' ? state.email : '';
}

/**
 * `/auth/forgot-password`: asks Identity to email a reset link. The answer
 * is the same whether or not the address has an account, so the page always
 * shows the same message.
 */
@Component({
  selector: 'bb-forgot-password-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    AuthScene,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bb-auth-scene video="login" formSide="right">
      <ng-container *transloco="let t">
        @if (sentTo(); as email) {
          <div class="result" role="status">
            <h1 class="title">{{ t('accountEmails.forgot.sentTitle') }}</h1>
            <p class="message">
              {{ t('accountEmails.forgot.sentText', { email }) }}
            </p>
            <p class="message">{{ t('accountEmails.forgot.sentHint') }}</p>
          </div>
          @if (error(); as code) {
            <p class="form-error" role="alert">{{ t(errorKey(code)) }}</p>
          }
          <div class="actions">
            <a mat-flat-button routerLink="/auth/login">{{
              t('accountEmails.backToLogin')
            }}</a>
            <button
              mat-stroked-button
              type="button"
              class="resend"
              [disabled]="secondsLeft() > 0 || pending()"
              (click)="send(email)"
            >
              @if (secondsLeft() > 0) {
                {{
                  t('accountEmails.forgot.resendIn', {
                    time: countdown(secondsLeft()),
                  })
                }}
              } @else {
                {{ t('accountEmails.forgot.resend') }}
              }
            </button>
          </div>
        } @else {
          @if (pending()) {
            <mat-progress-bar class="progress" mode="indeterminate" />
          }
          <h1 class="title">{{ t('accountEmails.forgot.title') }}</h1>
          <p class="subtitle">{{ t('accountEmails.forgot.subtitle') }}</p>

          <form
            class="stack"
            [formGroup]="form"
            (ngSubmit)="submit()"
            novalidate
          >
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
              } @else if (form.controls.email.invalid) {
                <mat-error>{{ t('validation.email') }}</mat-error>
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
              {{ t('accountEmails.forgot.submit') }}
            </button>
          </form>

          <p class="switch">
            <a routerLink="/auth/login">{{ t('accountEmails.backToLogin') }}</a>
          </p>
        }
      </ng-container>
    </bb-auth-scene>
  `,
  styles: AUTH_LINK_STYLES,
})
export class ForgotPasswordPage {
  private readonly api = inject(Api);
  /** Ticks every second while the resend button waits. */
  private readonly now = signal(Date.now());
  /** When Resend becomes available again. */
  private readonly resendAt = signal(0);
  protected readonly secondsLeft = computed(() =>
    Math.max(0, Math.ceil((this.resendAt() - this.now()) / 1000)),
  );

  constructor() {
    const timer = setInterval(() => {
      if (this.resendAt() > this.now()) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: [
      // The address typed on the login page, if any (navigation state, so
      // it never lands in the URL or the browser's history list).
      initialEmail(inject(DOCUMENT)),
      [
        Validators.required,
        emailAddress,
        Validators.maxLength(EMAIL_MAX_LENGTH),
      ],
    ],
  });
  protected readonly pending = signal(false);
  protected readonly error = signal<KnownErrorCode | null>(null);
  /** Set once the request went through. */
  protected readonly sentTo = signal<string | null>(null);
  protected readonly errorKey = errorKey;

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    await this.send(this.form.getRawValue().email.trim());
  }

  /** First send, and Resend (same address) once the minute has passed. */
  protected async send(email: string): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set(null);
    try {
      await this.api.invoke(authControllerRequestPasswordReset, {
        body: { email },
      });
      this.sentTo.set(email);
      this.now.set(Date.now());
      this.resendAt.set(this.now() + RESEND_AFTER_MS);
    } catch (err) {
      this.error.set(errorCode(err));
    } finally {
      this.pending.set(false);
    }
  }

  /** 0:42 */
  protected countdown(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
