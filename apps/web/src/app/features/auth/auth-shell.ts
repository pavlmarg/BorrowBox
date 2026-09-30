import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Layout for register, login and the Google callback: a light-blue backdrop
 * and one card whose content swaps between the pages. The card and its
 * content carry view-transition names, so route changes animate as one
 * surface changing (see `::view-transition-*` in styles.scss).
 */
@Component({
  selector: 'bb-auth-shell',
  imports: [RouterOutlet, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" aria-hidden="true">
      <span class="blob one"></span>
      <span class="blob two"></span>
      <span class="blob three"></span>
    </div>

    <section class="card" *transloco="let t">
      <header class="brand">
        <svg class="logo" viewBox="0 0 48 48" aria-hidden="true">
          <defs>
            <linearGradient id="bb-logo" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#7cc4ff" />
              <stop offset="1" stop-color="#1f6fb2" />
            </linearGradient>
          </defs>
          <rect width="48" height="48" rx="14" fill="url(#bb-logo)" />
          <path
            d="M14 20 24 14l10 6v12l-10 6-10-6z M14 20l10 6 10-6 M24 26v12"
            fill="none"
            stroke="#fff"
            stroke-width="2.4"
            stroke-linejoin="round"
          />
        </svg>
        <div>
          <p class="name">{{ t('app.name') }}</p>
          <p class="tagline">{{ t('app.tagline') }}</p>
        </div>
      </header>

      <div class="content">
        <router-outlet />
      </div>
    </section>
  `,
  styles: `
    :host {
      align-items: center;
      box-sizing: border-box;
      display: flex;
      justify-content: center;
      min-height: calc(100vh - 64px);
      padding: 16px 16px 48px;
    }

    .backdrop {
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      position: fixed;
      z-index: -1;
    }
    .blob {
      border-radius: 50%;
      filter: blur(60px);
      opacity: 0.55;
      position: absolute;
      animation: drift 18s ease-in-out infinite alternate;
    }
    .one {
      background: var(--bb-sky-300);
      height: 420px;
      left: -120px;
      top: -80px;
      width: 420px;
    }
    .two {
      animation-delay: -6s;
      background: var(--bb-sky-200);
      height: 360px;
      right: -100px;
      top: 30%;
      width: 360px;
    }
    .three {
      animation-delay: -12s;
      background: #b8f0ff;
      bottom: -140px;
      height: 380px;
      left: 25%;
      width: 380px;
    }
    @keyframes drift {
      to {
        transform: translate(40px, 30px) scale(1.08);
      }
    }

    .card {
      backdrop-filter: blur(14px);
      background: var(--bb-card-bg);
      border: 1px solid var(--bb-card-border);
      border-radius: var(--bb-radius);
      box-shadow: var(--bb-shadow-md);
      box-sizing: border-box;
      max-width: 440px;
      padding: 28px 28px 24px;
      view-transition-name: auth-card;
      width: 100%;
    }

    .brand {
      align-items: center;
      display: flex;
      gap: 14px;
      margin-bottom: 20px;
    }
    .logo {
      flex: none;
      height: 44px;
      width: 44px;
    }
    .name {
      font: var(--mat-sys-title-large);
      font-weight: 700;
      margin: 0;
    }
    .tagline {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 2px 0 0;
    }

    .content {
      view-transition-name: auth-content;
    }

    @media (max-width: 480px) {
      .card {
        padding: 22px 18px 18px;
      }
    }
  `,
})
export class AuthShell {}
