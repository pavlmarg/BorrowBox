import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Eye button for a password field's `matSuffix`: switches the target input
 * between hidden and visible text.
 */
@Component({
  selector: 'bb-password-toggle',
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      *transloco="let t"
      type="button"
      class="toggle"
      [attr.aria-label]="
        t(visible() ? 'auth.hidePassword' : 'auth.showPassword')
      "
      [attr.title]="t(visible() ? 'auth.hidePassword' : 'auth.showPassword')"
      [attr.aria-pressed]="visible()"
      (click)="visible.set(!visible())"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        />
        <circle cx="12" cy="12" r="3" />
        @if (visible()) {
          <path d="M4 20 20 4" />
        }
      </svg>
    </button>
  `,
  styles: `
    .toggle {
      align-items: center;
      background: none;
      border: 0;
      border-radius: 50%;
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
      display: inline-flex;
      height: 40px;
      justify-content: center;
      margin-right: 4px;
      transition:
        background-color var(--bb-fast) var(--bb-ease),
        color var(--bb-fast) var(--bb-ease);
      width: 40px;
    }
    .toggle:hover {
      background: var(--bb-sky-100);
      color: var(--bb-sky-700);
    }
    .toggle:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 0;
    }
    svg {
      fill: none;
      height: 22px;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.8;
      width: 22px;
    }
  `,
})
export class PasswordToggle {
  /** The password input this button reveals. */
  readonly target = input.required<HTMLInputElement>();
  protected readonly visible = signal(false);

  constructor() {
    effect(() => {
      this.target().type = this.visible() ? 'text' : 'password';
    });
  }
}
