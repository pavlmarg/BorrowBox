import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  effect,
  inject,
  untracked,
} from '@angular/core';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { DISPLAY_NAME_MAX_LENGTH } from '@borrowbox/contracts';
import type { Locale } from '../../api/models';
import { errorKey } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { LANGUAGES, LanguageService } from '../../core/i18n/language';
import { GoogleButton } from '../auth/google-button';
import {
  DeleteAccountDialog,
  type DeleteAccountDialogData,
  type DeleteAccountDialogResult,
} from './delete-account.dialog';
import { ProfileStore } from './profile.store';

@Component({
  selector: 'bb-profile-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    TranslocoDirective,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    GoogleButton,
  ],
  providers: [ProfileStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (auth.user(); as user) {
        <h1 class="page-title">{{ t('profile.title') }}</h1>

        @if (store.busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        @if (store.error(); as code) {
          <p class="form-error" role="alert">{{ t(errorKey(code)) }}</p>
          @if (code === 'REAUTHENTICATION_REQUIRED' && !user.hasPassword) {
            <bb-google-button
              returnUrl="/profile"
              label="deleteDialog.reauthenticate"
            />
          }
        }

        <div class="stack">
          <mat-card appearance="outlined">
            <mat-card-header>
              <mat-card-title>{{ t('profile.details') }}</mat-card-title>
              <mat-card-subtitle>
                {{
                  t('profile.memberSince', {
                    date:
                      (user.createdAt
                      | date: 'longDate' : undefined : language.formatLocale()),
                  })
                }}
              </mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
              <form
                class="stack"
                [formGroup]="form"
                (ngSubmit)="save()"
                novalidate
              >
                <mat-form-field>
                  <mat-label>{{ t('profile.email') }}</mat-label>
                  <input matInput [value]="user.email" disabled />
                  <mat-hint>{{
                    t(
                      user.emailVerified
                        ? 'profile.emailVerified'
                        : 'profile.emailNotVerified'
                    )
                  }}</mat-hint>
                </mat-form-field>

                <mat-form-field>
                  <mat-label>{{ t('profile.displayName') }}</mat-label>
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

                <mat-form-field>
                  <mat-label>{{ t('profile.language') }}</mat-label>
                  <mat-select formControlName="locale">
                    @for (lang of languages; track lang) {
                      <mat-option [value]="lang">{{
                        t('languages.' + lang)
                      }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <div class="actions">
                  @if (store.saved()) {
                    <span class="muted" role="status">{{
                      t('profile.saved')
                    }}</span>
                  }
                  <button
                    mat-flat-button
                    type="submit"
                    [disabled]="form.pristine || store.busy() !== null"
                  >
                    {{ t('profile.save') }}
                  </button>
                </div>
              </form>

              <mat-divider />
              <h3>{{ t('profile.signIn') }}</h3>
              <ul class="methods">
                @if (user.hasPassword) {
                  <li>{{ t('profile.withPassword') }}</li>
                }
                @for (provider of user.providers; track provider) {
                  <li>{{ t('profile.withGoogle') }}</li>
                }
              </ul>
            </mat-card-content>
          </mat-card>

          <mat-card appearance="outlined">
            <mat-card-header>
              <mat-card-title>{{ t('profile.export.title') }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <p class="muted">{{ t('profile.export.description') }}</p>
            </mat-card-content>
            <mat-card-actions align="end">
              @if (store.exported()) {
                <span class="muted" role="status">{{
                  t('profile.export.done')
                }}</span>
              }
              <button
                mat-stroked-button
                [disabled]="store.busy() !== null"
                (click)="store.exportData()"
              >
                {{ t('profile.export.button') }}
              </button>
            </mat-card-actions>
          </mat-card>

          <mat-card appearance="outlined">
            <mat-card-header>
              <mat-card-title>{{ t('profile.delete.title') }}</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <p class="muted">{{ t('profile.delete.description') }}</p>
            </mat-card-content>
            <mat-card-actions align="end">
              <button
                mat-stroked-button
                class="danger"
                [disabled]="store.busy() !== null"
                (click)="confirmDelete(user.hasPassword)"
              >
                {{ t('profile.delete.button') }}
              </button>
            </mat-card-actions>
          </mat-card>
        </div>
      }
    </ng-container>
  `,
  styles: `
    .actions {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    .methods {
      margin: 0;
      padding-left: 20px;
    }
    .danger {
      color: var(--mat-sys-error);
    }
    mat-card-actions {
      gap: 12px;
    }
  `,
})
export class ProfilePage implements OnInit {
  protected readonly auth = inject(AuthStore);
  protected readonly store = inject(ProfileStore);
  protected readonly language = inject(LanguageService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  protected readonly languages = LANGUAGES;
  protected readonly displayNameMax = DISPLAY_NAME_MAX_LENGTH;
  protected readonly errorKey = errorKey;
  protected readonly form = inject(NonNullableFormBuilder).group({
    displayName: [
      '',
      [
        Validators.required,
        Validators.maxLength(DISPLAY_NAME_MAX_LENGTH),
        Validators.pattern(/\S/),
      ],
    ],
    locale: ['el' as Locale],
  });

  constructor() {
    // Keep the form in step with the profile (load, save, other tabs) unless the user is editing.
    effect(() => {
      const user = this.auth.user();
      untracked(() => {
        if (user && this.form.pristine) {
          this.form.reset({
            displayName: user.displayName,
            locale: user.locale,
          });
        }
      });
    });
  }

  ngOnInit(): void {
    void this.store.load();
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { displayName, locale } = this.form.getRawValue();
    if (await this.store.save({ displayName: displayName.trim(), locale })) {
      this.language.use(locale);
      this.form.markAsPristine();
      const user = this.auth.user();
      if (user)
        this.form.reset({ displayName: user.displayName, locale: user.locale });
    }
  }

  protected confirmDelete(hasPassword: boolean): void {
    this.store.clearError();
    this.dialog
      .open<
        DeleteAccountDialog,
        DeleteAccountDialogData,
        DeleteAccountDialogResult
      >(DeleteAccountDialog, {
        data: { hasPassword },
        width: '440px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .subscribe(async (result) => {
        if (!result) return;
        if (await this.store.deleteAccount(result.password)) {
          await this.router.navigate(['/auth/login'], {
            queryParams: { deleted: 1 },
          });
        }
      });
  }
}
