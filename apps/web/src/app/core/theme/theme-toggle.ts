import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { TranslocoDirective } from '@jsverse/transloco';
import { THEME_PREFERENCES, ThemeService, type ThemePreference } from './theme';

/** Sun (light), moon (dark) or a half-filled circle (same as the device). */
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
        @case ('dark') {
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        }
        @default {
          <circle cx="12" cy="12" r="8.5" />
          <path class="fill" d="M12 3.5a8.5 8.5 0 0 1 0 17z" />
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
    .fill {
      fill: currentColor;
      stroke: none;
    }
  `,
})
export class ThemeIcon {
  readonly name = input.required<ThemePreference>();
}

/**
 * Light / dark / same-as-device switch: a small button showing the current
 * choice, opening a menu of the three. Sits beside the language toggle (top
 * bar, phone drawer, login and register) and looks like it.
 */
@Component({
  selector: 'bb-theme-toggle',
  imports: [MatMenuModule, TranslocoDirective, ThemeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <button
        type="button"
        class="toggle"
        [matMenuTriggerFor]="menu"
        [attr.aria-label]="
          t('theme.button', { choice: t('theme.' + preference()) })
        "
        [attr.title]="t('theme.label')"
      >
        <bb-theme-icon [name]="preference()" />
      </button>
      <mat-menu #menu="matMenu" [xPosition]="menuX()">
        @for (choice of choices; track choice) {
          <button
            mat-menu-item
            type="button"
            role="menuitemradio"
            class="theme-choice"
            [class.chosen]="choice === preference()"
            [attr.aria-checked]="choice === preference()"
            (click)="theme.use(choice)"
          >
            <bb-theme-icon class="choice-icon" [name]="choice" />
            <span>{{ t('theme.' + choice) }}</span>
          </button>
        }
      </mat-menu>
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
    .choice-icon {
      margin-right: 12px;
    }
    .chosen {
      color: var(--bb-sky-700);
      font-weight: 600;
    }
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  /** Which way the menu opens from the button. */
  readonly menuX = input<'before' | 'after'>('before');

  protected readonly choices = THEME_PREFERENCES;
  protected readonly preference = this.theme.preference;
}
