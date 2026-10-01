import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
import { NavIcon } from './nav-icon';
import { FOOTER_NAV, MAIN_NAV } from './nav-items';

/** At this width and up the sidebar stays open beside the page. */
const WIDE = '(min-width: 960px)';

/**
 * Layout for every signed-in page: a sidebar with the app's navigation on
 * desktop, and on phones a top bar whose ☰ button opens it as a drawer.
 */
@Component({
  selector: 'bb-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TranslocoDirective,
    MatSidenavModule,
    LanguageToggle,
    NavIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-sidenav-container class="container" *transloco="let t">
      <mat-sidenav
        id="bb-nav"
        class="sidebar"
        [mode]="wide() ? 'side' : 'over'"
        [opened]="wide() || menuOpen()"
        [disableClose]="wide()"
        [fixedInViewport]="!wide()"
        (openedChange)="menuOpen.set($event)"
      >
        <nav class="nav" [attr.aria-label]="t('nav.menu')">
          <div class="nav-head">
            <a class="brand" routerLink="/profile">{{ t('app.name') }}</a>
            @if (!wide()) {
              <button
                type="button"
                class="icon-button"
                [attr.aria-label]="t('nav.close')"
                (click)="menuOpen.set(false)"
              >
                <bb-nav-icon name="close" />
              </button>
            }
          </div>

          <ul class="links">
            @for (item of mainNav; track item.key) {
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
            <li class="language">
              <bb-language-toggle (changed)="accountLanguage.set($event)" />
              <span>{{ t('languages.' + language()) }}</span>
            </li>
          </ul>
        </nav>
      </mat-sidenav>

      <mat-sidenav-content class="page">
        @if (!wide()) {
          <header class="topbar">
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
            <a class="brand" routerLink="/profile">{{ t('app.name') }}</a>
            <bb-language-toggle (changed)="accountLanguage.set($event)" />
          </header>
        }
        <main class="main">
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
      /* Screen height: the page scrolls inside, the sidebar stays put. */
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
      border-radius: 999px;
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
      border-radius: 50%;
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
      display: flex;
      gap: 8px;
      height: 56px;
      padding: 0 12px 0 8px;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .topbar .brand {
      flex: 1;
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
  `,
})
export class AppShell {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);
  protected readonly accountLanguage = inject(AccountLanguage);
  protected readonly language = inject(LanguageService).current;

  protected readonly mainNav = MAIN_NAV;
  protected readonly footerNav = FOOTER_NAV;

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
