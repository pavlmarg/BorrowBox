import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { SmoothSwitch } from '../motion/smooth-switch';
import { ThemeService, type Theme } from './theme';

/** Sun (light) or moon (dark). */
@Component({
  selector: 'bb-theme-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (name()) {
        @case ('light') {
          <circle cx="12" cy="12" r="4.2" />
          <path
            d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"
          />
        }
        @default {
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      height: 18px;
      width: 18px;
    }
    svg {
      fill: none;
      height: 100%;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.8;
      width: 100%;
    }
  `,
})
export class ThemeIcon {
  readonly name = input.required<Theme>();
}

/**
 * One click switches between light and dark. Until the first click the page
 * follows the device. Shows where a click leads (the moon while light), and
 * sits beside the language toggle (top bar, phone drawer, login, register).
 */
@Component({
  selector: 'bb-theme-toggle',
  imports: [TranslocoDirective, ThemeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <button
        type="button"
        class="toggle"
        [attr.aria-label]="t('theme.' + next())"
        [attr.title]="t('theme.' + next())"
        [class.pop]="popping()"
        (click)="toggle($event)"
        (animationend)="popping.set(false)"
      >
        <bb-theme-icon [name]="next()" />
      </button>
    </ng-container>
  `,
  styles: `
    .toggle {
      align-items: center;
      backdrop-filter: blur(8px);
      background: rgb(var(--bb-surface-rgb) / 0.78);
      border: 1px solid rgb(var(--bb-line-rgb) / 0.1);
      border-radius: var(--bb-control-radius, 6px);
      box-shadow: var(--bb-shadow-sm);
      color: var(--bb-sky-700);
      cursor: pointer;
      display: inline-flex;
      /* As tall as the language toggle (16 px flag + 4 px padding). */
      padding: 3px 7px;
      transition:
        transform var(--bb-fast) var(--bb-ease),
        box-shadow var(--bb-medium) var(--bb-ease);
    }
    .toggle:hover {
      box-shadow: var(--bb-shadow-md);
      transform: translateY(-1px);
    }
    .toggle:active {
      transform: scale(0.97);
    }
    .toggle:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    /* A small turn of the icon on click. */
    .toggle.pop bb-theme-icon {
      animation: bb-theme-pop 380ms var(--bb-ease);
    }
    @keyframes bb-theme-pop {
      40% {
        transform: rotate(-35deg) scale(0.8);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toggle.pop bb-theme-icon {
        animation: none;
      }
    }
    /* In the app's top bar and drawer: a plain icon, no box or lift. */
    :host-context(bb-app-shell) .toggle {
      backdrop-filter: none;
      background: none;
      border-color: transparent;
      box-shadow: none;
      transform: none;
    }
  `,
})
export class ThemeToggle {
  private readonly theme = inject(ThemeService);
  private readonly smooth = inject(SmoothSwitch);
  protected readonly popping = signal(false);
  /** The theme a click switches to. */
  protected readonly next = computed<Theme>(() =>
    this.theme.theme() === 'dark' ? 'light' : 'dark',
  );

  protected toggle(event: Event): void {
    const next = this.next();
    this.popping.set(true);
    this.smooth.run(
      () => this.theme.use(next),
      event.currentTarget as HTMLElement,
    );
  }
}
