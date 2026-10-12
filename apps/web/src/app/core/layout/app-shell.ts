import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { filter, map } from 'rxjs';
import { AuthStore } from '../auth/auth.store';
import { AccountLanguage } from '../i18n/account-language';
import { LanguageService } from '../i18n/language';
import { LanguageToggle } from '../i18n/language-toggle';
import { Avatar } from '../../shared/avatar/avatar';
import { NavIcon } from './nav-icon';
import { FOOTER_NAV, MAIN_NAV } from './nav-items';

/** At this width and up the navigation sits in the top bar. */
const WIDE = '(min-width: 960px)';

/**
 * Layout for the app's pages: a top bar over the full width. On desktop it
 * holds the navigation, with the account pages in a menu under the avatar;
 * on phones its ☰ button opens the navigation as a drawer.
 */
@Component({
  selector: 'bb-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TranslocoDirective,
    MatSidenavModule,
    MatMenuModule,
    MatButtonModule,
    LanguageToggle,
    NavIcon,
    Avatar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-sidenav-container class="container" *transloco="let t">
      <mat-sidenav
        id="bb-nav"
        class="sidebar"
        mode="over"
        [opened]="!wide() && menuOpen()"
        [fixedInViewport]="true"
        (openedChange)="menuOpen.set($event)"
      >
        <nav class="nav" [attr.aria-label]="t('nav.menu')">
          <div class="nav-head">
            <a class="brand" routerLink="/explore">{{ t('app.name') }}</a>
            <button
              type="button"
              class="icon-button"
              [attr.aria-label]="t('nav.close')"
              (click)="menuOpen.set(false)"
            >
              <bb-nav-icon name="close" />
            </button>
          </div>

          <ul class="links">
            @for (item of barNav(); track item.key) {
              <li>
                @if (item.route) {
                  <a
                    class="link"
                    [routerLink]="item.route"
                    routerLinkActive="active"
                    ariaCurrentWhenActive="page"
                  >
                    <bb-nav-icon [name]="item.icon" />
                    <span>{{ t('nav.' + item.key) }}</span>
                  </a>
                } @else {
                  <span class="link soon" aria-disabled="true">
                    <bb-nav-icon [name]="item.icon" />
                    <span>{{ t('nav.' + item.key) }}</span>
                    <span class="badge">{{ t('nav.soon') }}</span>
                  </span>
                }
              </li>
            }
          </ul>

          <ul class="links footer">
            @if (signedIn()) {
              @for (item of footerNav; track item.key) {
                <li>
                  <a
                    class="link"
                    [routerLink]="item.route"
                    routerLinkActive="active"
                    ariaCurrentWhenActive="page"
                  >
                    <bb-nav-icon [name]="item.icon" />
                    <span>{{ t('nav.' + item.key) }}</span>
                  </a>
                </li>
              }
              <li>
                <button type="button" class="link" (click)="logout()">
                  <bb-nav-icon name="logout" />
                  <span>{{ t('nav.logout') }}</span>
                </button>
              </li>
            } @else {
              <li>
                <a
                  class="link"
                  routerLink="/auth/login"
                  [queryParams]="{ returnUrl: currentUrl() }"
                >
                  <bb-nav-icon name="login" />
                  <span>{{ t('nav.login') }}</span>
                </a>
              </li>
              <li>
                <a class="link" routerLink="/auth/register">
                  <bb-nav-icon name="register" />
                  <span>{{ t('nav.register') }}</span>
                </a>
              </li>
            }
            <li class="language">
              <bb-language-toggle (changed)="accountLanguage.set($event)" />
              <span>{{ t('languages.' + language()) }}</span>
            </li>
          </ul>
        </nav>
      </mat-sidenav>

      <mat-sidenav-content class="page">
        <header class="topbar" [class.wide]="wide()">
          @if (!wide()) {
            <button
              type="button"
              class="icon-button"
              aria-controls="bb-nav"
              [attr.aria-expanded]="menuOpen()"
              [attr.aria-label]="t('nav.open')"
              (click)="menuOpen.set(true)"
            >
              <bb-nav-icon name="menu" />
            </button>
          }
          <a class="brand" routerLink="/explore">{{ t('app.name') }}</a>
          @if (wide()) {
            <nav class="bar-nav" [attr.aria-label]="t('nav.menu')">
              <ul class="bar-links">
                @for (item of barNav(); track item.key) {
                  <li>
                    @if (item.route) {
                      <a
                        class="bar-link"
                        [routerLink]="item.route"
                        routerLinkActive="active"
                        ariaCurrentWhenActive="page"
                      >
                        <bb-nav-icon [name]="item.icon" />
                        <span>{{ t('nav.' + item.key) }}</span>
                      </a>
                    } @else {
                      <span class="bar-link soon" aria-disabled="true">
                        <bb-nav-icon [name]="item.icon" />
                        <span>{{ t('nav.' + item.key) }}</span>
                        <span class="badge">{{ t('nav.soon') }}</span>
                      </span>
                    }
                  </li>
                }
              </ul>
            </nav>
          }
          <span class="spacer"></span>
          <!-- Phones: the language is in the drawer, to leave room here. -->
          @if (wide()) {
            <bb-language-toggle (changed)="accountLanguage.set($event)" />
          }
          @if (signedIn()) {
            @if (!wide()) {
              <a
                class="account"
                routerLink="/profile"
                [attr.aria-label]="t('nav.profile')"
              >
                <bb-avatar [size]="32" />
              </a>
            } @else {
              <button
                type="button"
                class="account"
                [matMenuTriggerFor]="accountMenu"
                [attr.aria-label]="t('nav.account')"
              >
                <bb-avatar [size]="32" />
                <bb-nav-icon name="chevron-down" class="caret" />
              </button>
              <mat-menu #accountMenu="matMenu" xPosition="before">
                @for (item of accountNav; track item.key) {
                  <a
                    mat-menu-item
                    [routerLink]="item.route"
                    routerLinkActive="active"
                    ariaCurrentWhenActive="page"
                  >
                    <bb-nav-icon [name]="item.icon" class="menu-icon" />
                    <span>{{ t('nav.' + item.key) }}</span>
                  </a>
                }
                <button mat-menu-item type="button" (click)="logout()">
                  <bb-nav-icon name="logout" class="menu-icon" />
                  <span>{{ t('nav.logout') }}</span>
                </button>
              </mat-menu>
            }
          } @else {
            <a
              mat-button
              class="bar-button"
              routerLink="/auth/login"
              [queryParams]="{ returnUrl: currentUrl() }"
              >{{ t('nav.login') }}</a
            >
            <a mat-flat-button class="bar-button" routerLink="/auth/register">{{
              t(wide() ? 'nav.register' : 'nav.registerShort')
            }}</a>
          }
        </header>
        <main class="main" [class.full-bleed]="fullBleed()">
          <router-outlet />
        </main>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: `
    :host {
      display: block;
    }
    .container {
      --mat-sidenav-container-background-color: rgb(255 255 255 / 0.82);
      --mat-sidenav-container-divider-color: rgb(16 58 99 / 0.08);
      --mat-sidenav-container-shape: 0;
      --mat-sidenav-container-width: 280px;
      --mat-sidenav-content-background-color: transparent;
      background: transparent;
      /* Screen height: the page scrolls inside, under the sticky top bar. */
      height: 100dvh;
    }
    .sidebar {
      backdrop-filter: blur(12px);
      max-width: 85vw;
    }

    .nav {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-height: 100%;
      padding: 20px 12px 16px;
    }
    .nav-head {
      align-items: center;
      display: flex;
      justify-content: space-between;
      margin: 0 0 20px;
      padding: 0 12px;
    }
    .brand {
      color: var(--bb-sky-700);
      font: var(--mat-sys-title-large);
      font-weight: 800;
      letter-spacing: -0.4px;
      text-decoration: none;
    }

    .links {
      display: flex;
      flex-direction: column;
      gap: 2px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .footer {
      border-top: 1px solid rgb(16 58 99 / 0.08);
      margin-top: auto;
      padding-top: 12px;
    }
    .link {
      align-items: center;
      background: none;
      border: 0;
      border-radius: var(--bb-radius);
      box-sizing: border-box;
      color: var(--mat-sys-on-surface);
      cursor: pointer;
      display: flex;
      font: var(--mat-sys-body-large);
      font-size: 15px;
      gap: 12px;
      white-space: nowrap;
      padding: 10px 12px;
      text-align: left;
      text-decoration: none;
      transition:
        background-color var(--bb-fast) var(--bb-ease),
        color var(--bb-fast) var(--bb-ease),
        transform var(--bb-fast) var(--bb-ease);
      width: 100%;
    }
    a.link:hover,
    button.link:hover {
      background: var(--bb-sky-50);
      color: var(--bb-sky-700);
    }
    a.link:hover bb-nav-icon,
    button.link:hover bb-nav-icon {
      transform: scale(1.06);
    }
    bb-nav-icon {
      transition: transform var(--bb-fast) var(--bb-ease);
    }
    .link:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 0;
    }
    .link.active {
      background: var(--bb-sky-100);
      color: var(--bb-sky-700);
      font-weight: 600;
    }
    .soon {
      color: var(--mat-sys-on-surface-variant);
      cursor: default;
      opacity: 0.6;
    }
    .badge {
      background: var(--bb-sky-100);
      border-radius: var(--bb-radius);
      color: var(--bb-sky-700);
      font: var(--mat-sys-label-small);
      margin-left: auto;
      padding: 1px 7px;
    }
    .language {
      align-items: center;
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      font: var(--mat-sys-body-medium);
      gap: 12px;
      padding: 10px 8px;
    }

    .icon-button {
      align-items: center;
      background: none;
      border: 0;
      border-radius: var(--bb-button-radius);
      color: var(--mat-sys-on-surface);
      cursor: pointer;
      display: inline-flex;
      height: 40px;
      justify-content: center;
      transition: background-color var(--bb-fast) var(--bb-ease);
      width: 40px;
    }
    .icon-button:hover {
      background: var(--bb-sky-100);
    }
    .icon-button:focus-visible {
      outline: 3px solid var(--bb-sky-300);
    }

    .topbar {
      align-items: center;
      backdrop-filter: blur(12px);
      background: rgb(255 255 255 / 0.8);
      border-bottom: 1px solid rgb(16 58 99 / 0.08);
      /* 64 px with its border, as Explore's height assumes. */
      box-sizing: border-box;
      display: flex;
      gap: 8px;
      height: 64px;
      padding: 0 12px 0 8px;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .topbar.wide {
      gap: 4px;
      padding: 0 24px;
    }
    .topbar .brand {
      margin-right: 20px;
    }
    .topbar:not(.wide) .brand {
      flex: 1;
    }
    .spacer {
      flex: 1;
    }
    .bar-nav {
      align-self: stretch;
    }
    .bar-links {
      display: flex;
      gap: 4px;
      height: 100%;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .bar-links li {
      display: flex;
    }
    /* Tab-like links: the active page is underlined at the bar's bottom. */
    .bar-link {
      align-items: center;
      border-bottom: 2px solid transparent;
      box-sizing: border-box;
      color: var(--mat-sys-on-surface);
      display: flex;
      font: var(--mat-sys-body-large);
      font-size: 15px;
      gap: 8px;
      padding: 0 12px;
      text-decoration: none;
      transition:
        background-color var(--bb-fast) var(--bb-ease),
        border-color var(--bb-fast) var(--bb-ease),
        color var(--bb-fast) var(--bb-ease);
      white-space: nowrap;
    }
    .bar-link bb-nav-icon {
      height: 20px;
      width: 20px;
    }
    a.bar-link:hover {
      background: var(--bb-sky-50);
      color: var(--bb-sky-700);
    }
    .bar-link:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: -3px;
    }
    .bar-link.active {
      border-bottom-color: var(--bb-sky-700);
      color: var(--bb-sky-700);
      font-weight: 600;
    }
    .bar-link .badge {
      margin-left: 2px;
    }
    .account {
      align-items: center;
      background: none;
      border: 0;
      border-radius: var(--bb-button-radius);
      cursor: pointer;
      display: inline-flex;
      gap: 2px;
      margin-left: 8px;
      padding: 4px;
      transition: background-color var(--bb-fast) var(--bb-ease);
    }
    .account:hover {
      background: var(--bb-sky-100);
    }
    .account:focus-visible {
      outline: 3px solid var(--bb-sky-300);
    }
    .caret {
      color: var(--mat-sys-on-surface-variant);
      height: 18px;
      width: 18px;
    }
    .menu-icon {
      display: inline-flex;
      height: 20px;
      margin-right: 12px;
      vertical-align: -5px;
      width: 20px;
    }
    .bar-button {
      margin-left: 8px;
    }
    /* Phones: two compact buttons beside the name. */
    .topbar:not(.wide) .bar-button {
      margin-left: 0;
      min-width: 0;
      padding: 0 12px;
    }

    .main {
      box-sizing: border-box;
      margin: 0 auto;
      max-width: 960px;
      padding: 32px 40px 48px;
    }
    @media (max-width: 959px) {
      .main {
        padding: 20px 16px 40px;
      }
    }
    /* Pages like Explore use the whole area (route data fullBleed). */
    .main.full-bleed {
      max-width: none;
      padding: 0;
    }
  `,
})
export class AppShell {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);
  protected readonly accountLanguage = inject(AccountLanguage);
  protected readonly language = inject(LanguageService).current;

  protected readonly signedIn = this.auth.isAuthenticated;
  /** Signed-out visitors don't see pages they can't open (E3). */
  protected readonly mainNav = computed(() =>
    MAIN_NAV.filter((item) => this.signedIn() || !item.requiresAuth),
  );
  protected readonly footerNav = FOOTER_NAV;
  /**
   * The bar's links (desktop) and the drawer's (phones). Profile is left
   * out: it's under the avatar, in the menu or as the phone bar's link.
   */
  protected readonly barNav = computed(() =>
    this.mainNav().filter((item) => !item.accountMenu),
  );
  protected readonly accountNav = [
    ...MAIN_NAV.filter((item) => item.accountMenu),
    ...FOOTER_NAV,
  ];

  private readonly navigationEnd = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)),
  );
  /** Where "Sign in" brings the visitor back to. */
  protected readonly currentUrl = computed(() => {
    this.navigationEnd();
    return this.router.url;
  });
  /** The page asked for the whole area (route data `fullBleed`). */
  protected readonly fullBleed = computed(() => {
    this.navigationEnd();
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return route.data['fullBleed'] === true;
  });

  protected readonly wide = toSignal(
    this.breakpoints.observe(WIDE).pipe(map((state) => state.matches)),
    { initialValue: this.breakpoints.isMatched(WIDE) },
  );
  /** Phones only: whether the drawer is open. */
  protected readonly menuOpen = signal(false);

  constructor() {
    // Following a link closes the drawer.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuOpen.set(false));
  }

  protected async logout(): Promise<void> {
    await this.auth.logout().catch(() => undefined);
    await this.router.navigateByUrl('/auth/login');
  }
}
