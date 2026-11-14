import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  type OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
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

        <div class="layout">
          <nav class="jump" [attr.aria-label]="t('settings.menu')">
            @for (s of sections; track s.id) {
              <a
                [href]="'/settings#' + s.id"
                [class.active]="active() === s.id"
                [attr.aria-current]="active() === s.id ? 'location' : null"
                (click)="jump($event, s.id)"
                >{{ t(s.title) }}</a
              >
            }
          </nav>

          <div class="content">
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
                    <mat-error>{{
                      t('profile.bio.errors.' + problem)
                    }}</mat-error>
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
                <span class="bb-text-action">{{
                  t('profile.payouts.link')
                }}</span>
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
          </div>
        </div>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
    /* Wide screens: the jump menu in a column on the left that stays in
       view; the sections on the right. */
    .layout {
      align-items: start;
      display: grid;
      gap: 40px;
      grid-template-columns: 200px minmax(0, 640px);
    }
    .jump {
      display: flex;
      flex-direction: column;
      gap: 4px;
      position: sticky;
      /* Below the top bar (64 px). */
      top: 88px;
    }
    .jump a {
      border-left: 3px solid transparent;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-large);
      padding: 8px 14px;
      text-decoration: none;
      transition:
        color var(--bb-fast) var(--bb-ease),
        border-color var(--bb-fast) var(--bb-ease);
    }
    .jump a:hover {
      color: var(--mat-sys-on-surface);
    }
    .jump a.active {
      border-left-color: var(--mat-sys-primary);
      color: var(--mat-sys-primary);
      font-weight: 500;
    }
    .jump a:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    /* The first section's line would sit right under the title. */
    .content > .section:first-of-type {
      border-top: none;
      padding-top: 0;
    }
    /* Narrow screens: one row above the sections, scrolled sideways. */
    @media (max-width: 839px) {
      .layout {
        display: block;
      }
      .jump {
        background: var(--mat-sys-surface);
        border-bottom: 1px solid rgb(var(--bb-line-rgb) / 0.08);
        flex-direction: row;
        gap: 4px;
        margin: 0 -16px 16px;
        overflow-x: auto;
        padding: 0 16px;
        scrollbar-width: none;
        top: 64px;
        z-index: 1;
      }
      .jump a {
        border-bottom: 2px solid transparent;
        border-left: none;
        flex: none;
        padding: 10px 8px;
      }
      .jump a.active {
        border-bottom-color: var(--mat-sys-primary);
      }
      .content > .section:first-of-type {
        padding-top: 8px;
      }
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
  /** The section being read, highlighted in the jump menu. */
  protected readonly active = signal<string>(SECTIONS[0].id);
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
    // Scroll events don't bubble: catch the content area's on the way down.
    const onScroll = (event: Event) => this.trackActive(event);
    this.document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('scroll', onScroll, { capture: true });
      if (this.hold) clearTimeout(this.hold);
    });
    // Opened as /settings#section: go there once it's on screen.
    const fragment = inject(ActivatedRoute).snapshot.fragment;
    afterNextRender(() => {
      if (fragment) {
        this.scrollTo(fragment, false);
        if (SECTIONS.some((s) => s.id === fragment)) this.active.set(fragment);
      }
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
    this.active.set(id);
    // Hold the highlight on the chosen section while the page glides there,
    // rather than following each section it passes on the way.
    this.holdActive(200);
    this.scrollTo(id, true);
  }

  /** While set, scrolling doesn't move the highlight. */
  private hold: ReturnType<typeof setTimeout> | null = null;

  /** Holds the highlight until scrolling has been still for `ms`. */
  private holdActive(ms: number): void {
    if (this.hold) clearTimeout(this.hold);
    this.hold = setTimeout(() => (this.hold = null), ms);
  }

  /**
   * Highlights the last section whose top has passed under the top bar;
   * at the very bottom, the last one (it may be too short to get there).
   */
  private trackActive(event: Event): void {
    // The shell scrolls its content area, not the window.
    const scroller =
      event.target instanceof Element
        ? event.target
        : this.document.documentElement;
    if (!scroller.contains(this.document.getElementById(SECTIONS[0].id)))
      return;
    if (this.hold) {
      this.holdActive(150);
      return;
    }
    if (
      scroller.scrollTop + scroller.clientHeight >=
      scroller.scrollHeight - 2
    ) {
      this.active.set(SECTIONS[SECTIONS.length - 1].id);
      return;
    }
    let current: string = SECTIONS[0].id;
    for (const s of SECTIONS) {
      const el = this.document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top <= 140) current = s.id;
    }
    this.active.set(current);
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
