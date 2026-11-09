import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { Locale } from '../../api/models';
import { SmoothSwitch } from '../motion/smooth-switch';
import { LanguageService } from './language';

/** Counts instances, for unique SVG ids. */
let toggles = 0;

/**
 * Compact el/en switch showing the current language's flag; one click
 * switches instantly (no menu). Flags are inline SVG, since Windows doesn't
 * render flag emoji and nothing may be loaded from third-party CDNs.
 */
@Component({
  selector: 'bb-language-toggle',
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      *transloco="let t"
      type="button"
      class="toggle"
      [attr.aria-label]="
        t('nav.switchTo', { language: t('languages.' + next()) })
      "
      [attr.title]="t('languages.' + next())"
      [class.pop]="popping()"
      (click)="toggle($event)"
      (animationend)="popping.set(false)"
    >
      @if (current() === 'en') {
        <span class="flag" lang="en">
          <svg
            viewBox="0 0 60 30"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <clipPath [attr.id]="clipId">
              <path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z" />
            </clipPath>
            <path d="M0,0v30h60v-30z" fill="#012169" />
            <path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6" />
            <path
              d="M0,0L60,30M60,0L0,30"
              [attr.clip-path]="'url(#' + clipId + ')'"
              stroke="#C8102E"
              stroke-width="4"
            />
            <path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10" />
            <path d="M30,0v30M0,15h60" stroke="#C8102E" stroke-width="6" />
          </svg>
        </span>
      } @else {
        <span class="flag" lang="el">
          <svg
            viewBox="0 0 27 18"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <rect width="27" height="18" fill="#0D5EAF" />
            <path
              d="M0 3h27M0 7h27M0 11h27M0 15h27"
              stroke="#fff"
              stroke-width="2"
            />
            <rect width="10" height="10" fill="#0D5EAF" />
            <path d="M5 0v10M0 5h10" stroke="#fff" stroke-width="2" />
          </svg>
        </span>
      }
    </button>
  `,
  styles: `
    .toggle {
      align-items: center;
      backdrop-filter: blur(8px);
      background: rgb(var(--bb-surface-rgb) / 0.78);
      border: 1px solid rgb(var(--bb-line-rgb) / 0.1);
      border-radius: var(--bb-control-radius, 6px);
      box-shadow: var(--bb-shadow-sm);
      cursor: pointer;
      display: inline-flex;
      padding: 4px;
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
    /* A small squeeze of the flag on click. */
    .toggle.pop .flag {
      animation: bb-flag-pop 320ms var(--bb-ease);
    }
    @keyframes bb-flag-pop {
      40% {
        transform: scale(0.8);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toggle.pop .flag {
        animation: none;
      }
    }
    /* In the app's top bar and drawer: the plain flag, no box or lift. */
    :host-context(bb-app-shell) .toggle {
      backdrop-filter: none;
      background: none;
      border-color: transparent;
      box-shadow: none;
      transform: none;
    }

    .flag {
      border-radius: var(--bb-flag-radius, 3px);
      display: block;
      height: 16px;
      overflow: hidden;
      width: 24px;
    }
    .flag svg {
      display: block;
      height: 100%;
      width: 100%;
    }
  `,
})
export class LanguageToggle {
  private readonly language = inject(LanguageService);
  private readonly smooth = inject(SmoothSwitch);
  protected readonly popping = signal(false);

  /** Emits the newly chosen language (the app saves it for signed-in users). */
  readonly changed = output<Locale>();

  /** The toggle is in the bar and in the drawer: SVG ids must be unique. */
  protected readonly clipId = `bb-uk-clip-${++toggles}`;
  protected readonly current = computed(() => this.language.current());
  protected readonly next = computed<Locale>(() =>
    this.current() === 'el' ? 'en' : 'el',
  );

  protected toggle(event: Event): void {
    const next = this.next();
    this.popping.set(true);
    this.smooth.run(
      () => this.changed.emit(next),
      event.currentTarget as HTMLElement,
    );
  }
}
