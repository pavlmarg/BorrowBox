import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { NeighboursScene } from './neighbours-scene';

/**
 * Layout for register, login and the Google callback: the form card on the
 * left, an illustration of neighbours lending to each other on the right
 * (hidden on narrow screens). The card content carries a view-transition
 * name, so switching pages slides like a window (styles.scss +
 * core/ui/view-transitions.ts).
 */
@Component({
  selector: 'bb-auth-shell',
  imports: [RouterOutlet, TranslocoDirective, NeighboursScene],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <div class="backdrop" aria-hidden="true">
        <span class="blob one"></span>
        <span class="blob two"></span>
        <span class="blob three"></span>
      </div>

      <div class="layout">
        <section class="card">
          <header class="brand">
            <p class="name">{{ t('app.name') }}</p>
            <p class="tagline">{{ t('app.tagline') }}</p>
          </header>
          <div class="content">
            <router-outlet />
          </div>
        </section>

        <aside class="scene">
          <bb-neighbours-scene [label]="t('auth.scene.label')" />
          <p class="caption">{{ t('auth.scene.caption') }}</p>
        </aside>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      box-sizing: border-box;
      display: block;
      min-height: calc(100vh - 64px);
      padding: 16px 24px 48px;
    }

    .backdrop {
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      position: fixed;
      z-index: -1;
    }
    .blob {
      animation: drift 18s ease-in-out infinite alternate;
      border-radius: 50%;
      filter: blur(60px);
      opacity: 0.55;
      position: absolute;
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

    .layout {
      align-items: center;
      display: grid;
      gap: 48px;
      grid-template-columns: minmax(0, 440px) minmax(0, 580px);
      justify-content: center;
      margin: 0 auto;
      max-width: 1120px;
      min-height: calc(100vh - 64px - 64px);
    }

    .card {
      backdrop-filter: blur(14px);
      background: var(--bb-card-bg);
      border: 1px solid var(--bb-card-border);
      border-radius: var(--bb-radius);
      box-shadow: var(--bb-shadow-md);
      box-sizing: border-box;
      padding: 28px 28px 24px;
      view-transition-name: auth-card;
      width: 100%;
    }

    .brand {
      margin-bottom: 22px;
    }
    .name {
      color: var(--bb-sky-700);
      font: var(--mat-sys-headline-small);
      font-weight: 800;
      letter-spacing: -0.4px;
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

    .scene {
      margin: 0;
    }
    .scene bb-neighbours-scene {
      border-radius: var(--bb-radius);
      box-shadow: var(--bb-shadow-md);
      overflow: hidden;
    }
    .caption {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-title-medium);
      margin: 16px 4px 0;
      text-align: center;
    }

    /* Narrow screens: just the form, centred. */
    @media (max-width: 959px) {
      :host {
        padding: 16px 16px 40px;
      }
      .layout {
        grid-template-columns: minmax(0, 440px);
        min-height: calc(100vh - 64px - 56px);
      }
      .scene {
        display: none;
      }
    }
    @media (max-width: 480px) {
      .card {
        padding: 22px 18px 18px;
      }
    }
  `,
})
export class AuthShell {}
