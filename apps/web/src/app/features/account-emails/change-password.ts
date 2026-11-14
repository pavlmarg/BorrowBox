import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormGroupDirective,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslocoDirective } from '@jsverse/transloco';
import { PASSWORD_MAX_LENGTH } from '@borrowbox/contracts';
import { Api } from '../../api/api';
import {
  authControllerRequestPasswordReset,
  meControllerChangePassword,
} from '../../api/functions';
import {
  errorCode,
  errorKey,
  type KnownErrorCode,
} from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { PasswordToggle } from '../auth/password-toggle';
import {
  matchesPasswordValidator,
  passwordValidator,
} from '../auth/password.validator';

type Busy = 'changing' | 'sending' | null;

/**
 * The password page (`/settings/password`, from Settings). With a password: current + new + confirm,
 * after which Identity signs out the other sessions (this one stays).
 * Google-only accounts have none to change, so they get a reset link to
 * their own address instead (setting it signs out every session).
 */
@Component({
  selector: 'bb-change-password',
  imports: [
    ReactiveFormsModule,
    TranslocoDirective,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    PasswordToggle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card appearance="outlined" *transloco="let t">
      <!-- The page's heading is its title (/settings/password). -->
      <mat-card-content>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        @if (hasPassword()) {
          <form
            class="stack"
            [formGroup]="form"
            (ngSubmit)="change()"
            novalidate
          >
            <mat-form-field>
              <mat-label>{{ t('accountEmails.password.current') }}</mat-label>
              <input
                #currentInput
                matInput
                type="password"
                formControlName="currentPassword"
                autocomplete="current-password"
                [maxlength]="passwordMax"
              />
              <bb-password-toggle matSuffix [target]="currentInput" />
              @if (form.controls.currentPassword.hasError('required')) {
                <mat-error>{{ t('validation.required') }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
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

            <mat-form-field class="confirm">
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

            <div aria-live="polite">
              @if (changed()) {
                <p class="done">{{ t('accountEmails.password.changed') }}</p>
              }
              @if (error(); as code) {
                <p class="form-error">
                  {{
                    code === 'INVALID_CREDENTIALS'
                      ? t('accountEmails.password.wrongCurrent')
                      : t(errorKey(code))
                  }}
                </p>
              }
            </div>

            <div class="actions">
              <button
                mat-flat-button
                type="submit"
                [disabled]="busy() !== null"
              >
                {{ t('accountEmails.password.submit') }}
              </button>
            </div>
          </form>
        } @else {
          <p class="muted">{{ t('accountEmails.password.noPassword') }}</p>
          <div aria-live="polite">
            @if (linkSentTo(); as email) {
              <p class="done">
                {{ t('accountEmails.password.linkSent', { email }) }}
              </p>
            }
            @if (error(); as code) {
              <p class="form-error">{{ t(errorKey(code)) }}</p>
            }
          </div>
          <div class="actions">
            <button
              mat-stroked-button
              type="button"
              [disabled]="busy() !== null"
              (click)="sendLink()"
            >
              {{
                t(
                  linkSentTo()
                    ? 'accountEmails.sendAgain'
                    : 'accountEmails.password.sendLink'
                )
              }}
            </button>
          </div>
        }
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .confirm {
      margin-top: 12px;
    }
    .actions {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    .done,
    .form-error {
      margin: 0 0 12px;
    }
    .done {
      font-weight: 500;
    }
    .muted {
      margin: 0 0 12px;
    }
    /* No panel (as Settings' other sections): content lines up with the title. */
    mat-card-content {
      padding-inline: 0;
    }
  `,
})
export class ChangePassword {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly formDirective = viewChild(FormGroupDirective);

  /** Identity said there is none (the profile was out of date). */
  private readonly passwordNotSet = signal(false);
  protected readonly hasPassword = computed(
    () => !!this.auth.user()?.hasPassword && !this.passwordNotSet(),
  );
  protected readonly passwordMax = PASSWORD_MAX_LENGTH;
  protected readonly form = inject(NonNullableFormBuilder).group({
    currentPassword: ['', Validators.required],
    password: ['', [Validators.required, passwordValidator]],
    confirmPassword: ['', [Validators.required, matchesPasswordValidator]],
  });
  protected readonly busy = signal<Busy>(null);
  protected readonly error = signal<KnownErrorCode | null>(null);
  protected readonly changed = signal(false);
  protected readonly linkSentTo = signal<string | null>(null);
  protected readonly errorKey = errorKey;

  constructor() {
    // Editing the password re-checks the confirmation.
    this.form.controls.password.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() =>
        this.form.controls.confirmPassword.updateValueAndValidity(),
      );
  }

  protected async change(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { currentPassword, password } = this.form.getRawValue();
    this.start('changing');
    try {
      await this.api.invoke(meControllerChangePassword, {
        body: { currentPassword, newPassword: password },
      });
      this.changed.set(true);
      // Clears the fields and their "submitted" error state.
      this.formDirective()?.resetForm();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'PASSWORD_NOT_SET') this.passwordNotSet.set(true);
      else this.error.set(code);
    } finally {
      this.busy.set(null);
    }
  }

  /** A reset link to the account's own address; always answered 202. */
  protected async sendLink(): Promise<void> {
    const email = this.auth.user()?.email;
    if (!email) return;
    this.start('sending');
    try {
      await this.api.invoke(authControllerRequestPasswordReset, {
        body: { email },
      });
      this.linkSentTo.set(email);
    } catch (err) {
      this.error.set(errorCode(err));
    } finally {
      this.busy.set(null);
    }
  }

  private start(busy: Busy): void {
    this.busy.set(busy);
    this.error.set(null);
    this.changed.set(false);
  }
}
