import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  type OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from '@borrowbox/contracts';
import type { Locale } from '../../api/models';
import { errorKey } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { LANGUAGES, LanguageService } from '../../core/i18n/language';
import { VerifyEmailNotice } from '../account-emails/verify-email-notice';
import { GoogleButton } from '../auth/google-button';
import {
  DeleteAccountDialog,
  type DeleteAccountDialogData,
  type DeleteAccountDialogResult,
} from './delete-account.dialog';
import { ThemeService } from '../../core/theme/theme';
import { ProfilePhotoCard } from './profile-photo-card';
import { ProfileStore } from './profile.store';
import {
  bioLength,
  bioRule,
  maxCharacters,
} from '../../shared/forms/validators';

/** Settings' sections, in order: their anchors and headings. */
const SECTIONS = [
  { id: 'photo', title: 'profile.photo.title' },
  { id: 'details', title: 'profile.details' },
  { id: 'password', title: 'accountEmails.password.title' },
  { id: 'appearance', title: 'profile.appearance.title' },
  { id: 'payouts', title: 'profile.payouts.title' },
  { id: 'data', title: 'profile.export.title' },
  { id: 'delete', title: 'profile.delete.title' },
] as const;

/**
 * Settings: one section per topic, each with a heading and a line about
 * it, and a small menu at the top that jumps to them (`/settings#details`).
 * Changing the password has a page of its own (`/settings/password`).
 */
@Component({
  selector: 'bb-settings-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSlideToggleModule,
    GoogleButton,
    VerifyEmailNotice,
    ProfilePhotoCard,
  ],
  providers: [ProfileStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (auth.user(); as user) {
        <h1 class="page-title">{{ t('nav.settings') }}</h1>

        <nav class="jump" [attr.aria-label]="t('settings.menu')">
          @for (s of sections; track s.id) {
            <a [href]="'/settings#' + s.id" (click)="jump($event, s.id)">{{
              t(s.title)
            }}</a>
          }
        </nav>

        <bb-verify-email-notice />

        @if (store.busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        @if (store.error(); as code) {
          <p class="form-error" role="alert">{{ t(errorKey(code)) }}</p>
          @if (code === 'REAUTHENTICATION_REQUIRED' && !user.hasPassword) {
            <!-- A fresh Google sign-in starts a new session; the old one is
                 not revoked but ends on its own and is pruned at a later
                 sign-in (SessionService.start). -->
            <bb-google-button
              returnUrl="/settings"
              label="deleteDialog.reauthenticate"
            />
          }
        }

        <section id="photo" class="section">
          <h2>{{ t('profile.photo.title') }}</h2>
          <p class="info">{{ t('settings.info.photo') }}</p>
          <bb-profile-photo-card />
        </section>

        <section id="details" class="section">
          <h2>{{ t('profile.details') }}</h2>
          <p class="info">{{ t('settings.info.details') }}</p>
          <form class="stack" [formGroup]="form" (ngSubmit)="save()" novalidate>
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
              />
              @if (form.controls.displayName.invalid) {
                <mat-error>{{ t('validation.displayName') }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field>
              <mat-label>{{ t('profile.bio.label') }}</mat-label>
              <textarea
                matInput
                formControlName="bio"
                rows="3"
                [placeholder]="t('profile.bio.placeholder')"
              ></textarea>
              <mat-hint>{{ t('profile.bio.hint') }}</mat-hint>
              <mat-hint align="end">{{ bioCount() }}/{{ bioMax }}</mat-hint>
              @if (form.controls.bio.errors?.['bio']; as problem) {
                <mat-error>{{ t('profile.bio.errors.' + problem) }}</mat-error>
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
        </section>

        <section id="password" class="section">
          <h2>{{ t('accountEmails.password.title') }}</h2>
          <p class="info">
            {{
              t(
                user.hasPassword
                  ? 'settings.password.info'
                  : 'settings.password.infoNone'
              )
            }}
          </p>
          <a mat-stroked-button routerLink="/settings/password">{{
            t(
              user.hasPassword
                ? 'settings.password.change'
                : 'settings.password.set'
            )
          }}</a>
        </section>

        <section id="appearance" class="section">
          <h2>{{ t('profile.appearance.title') }}</h2>
          <p class="info">{{ t('profile.appearance.hint') }}</p>
          <mat-slide-toggle
            [checked]="theme.preference() === 'system'"
            (change)="followDevice($event.checked)"
            >{{ t('profile.appearance.followDevice') }}</mat-slide-toggle
          >
        </section>

        <section id="payouts" class="section">
          <h2>{{ t('profile.payouts.title') }}</h2>
          <p class="info">{{ t('profile.payouts.description') }}</p>
          <a
            class="payouts-link bb-text-action-host"
            routerLink="/settings/payouts"
          >
            <span class="bb-text-action">{{ t('profile.payouts.link') }}</span>
            <span aria-hidden="true">›</span>
          </a>
        </section>

        <section id="data" class="section">
          <h2>{{ t('profile.export.title') }}</h2>
          <p class="info">{{ t('profile.export.description') }}</p>
          <div class="row">
            <button
              mat-stroked-button
              type="button"
              [disabled]="store.busy() !== null"
              (click)="store.exportData()"
            >
              {{ t('profile.export.button') }}
            </button>
            @if (store.exported()) {
              <span class="muted" role="status">{{
                t('profile.export.done')
              }}</span>
            }
          </div>
        </section>

        <section id="delete" class="section">
          <h2>{{ t('profile.delete.title') }}</h2>
          <p class="info">{{ t('profile.delete.description') }}</p>
          <button
            mat-stroked-button
            type="button"
            class="danger"
            [disabled]="store.busy() !== null"
            (click)="confirmDelete(user.hasPassword)"
          >
            {{ t('profile.delete.button') }}
          </button>
        </section>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      max-width: 720px;
    }
    /* The jump menu: small links to each section. */
    .jump {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 24px;
    }
    .jump a {
      border: 1px solid rgb(var(--bb-line-rgb) / 0.16);
      border-radius: var(--bb-button-radius);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
      padding: 4px 10px;
      text-decoration: none;
      transition: color var(--bb-fast) var(--bb-ease);
    }
    .jump a:hover {
      color: var(--mat-sys-primary);
    }
    .jump a:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .section {
      border-top: 1px solid rgb(var(--bb-line-rgb) / 0.08);
      padding: 24px 0 28px;
      /* Clear of the top bar when jumped to. */
      scroll-margin-top: 80px;
    }
    .section h2 {
      font: var(--mat-sys-title-large);
      margin: 0 0 4px;
    }
    .info {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 0 0 16px;
      max-width: 60ch;
    }
    .actions {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    .row {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .danger {
      color: var(--mat-sys-error);
    }
    .payouts-link {
      align-items: center;
      color: var(--mat-sys-primary);
      display: inline-flex;
      font-weight: 500;
      gap: 6px;
      text-decoration: none;
    }
  `,
})
export class SettingsPage implements OnInit {
  protected readonly auth = inject(AuthStore);
  protected readonly store = inject(ProfileStore);
  protected readonly language = inject(LanguageService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  protected readonly theme = inject(ThemeService);

  protected readonly sections = SECTIONS;
  protected readonly languages = LANGUAGES;
  protected readonly errorKey = errorKey;
  protected readonly form = inject(NonNullableFormBuilder).group({
    displayName: [
      '',
      [
        Validators.required,
        maxCharacters(DISPLAY_NAME_MAX_LENGTH),
        Validators.pattern(/\S/),
      ],
    ],
    locale: ['el' as Locale],
    bio: ['', [bioRule]],
  });
  protected readonly bioMax = BIO_MAX_LENGTH;
  private readonly bioValue = toSignal(this.form.controls.bio.valueChanges, {
    initialValue: '',
  });
  protected readonly bioCount = computed(() => bioLength(this.bioValue()));

  constructor() {
    // Keep the form in step with the profile (load, save, other tabs) unless the user is editing.
    effect(() => {
      const user = this.auth.user();
      untracked(() => {
        if (user && this.form.pristine) {
          this.form.reset({
            displayName: user.displayName,
            locale: user.locale,
            bio: user.bio ?? '',
          });
        }
      });
    });
    // Opened as /settings#section: go there once it's on screen.
    const fragment = inject(ActivatedRoute).snapshot.fragment;
    afterNextRender(() => {
      if (fragment) this.scrollTo(fragment, false);
    });
  }

  ngOnInit(): void {
    void this.store.load();
  }

  /** The jump menu: scroll to the section and show it in the address (`#…`). */
  protected jump(event: MouseEvent, id: string): void {
    // New tabs and windows keep their usual way.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0)
      return;
    event.preventDefault();
    this.location.replaceState(`/settings#${id}`);
    this.scrollTo(id, true);
  }

  private scrollTo(id: string, smooth: boolean): void {
    const target = this.document.getElementById(id);
    if (!target) return;
    const reduced = this.document.defaultView?.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    target.scrollIntoView({
      behavior: smooth && !reduced ? 'smooth' : 'auto',
      block: 'start',
    });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { displayName, locale, bio } = this.form.getRawValue();
    if (
      await this.store.save({ displayName: displayName.trim(), locale, bio })
    ) {
      this.language.use(locale);
      this.form.markAsPristine();
      const user = this.auth.user();
      if (user)
        this.form.reset({
          displayName: user.displayName,
          locale: user.locale,
          bio: user.bio ?? '',
        });
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

  /** On: follow the device. Off: keep today's look, chosen by the top bar's button. */
  protected followDevice(on: boolean): void {
    this.theme.use(on ? 'system' : this.theme.theme());
  }
}
