import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { Locale } from '../../api/models';
import { LanguageService } from './language';

/**
 * Compact el/en switch: both flags, the active one highlighted; one click
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
      (click)="toggle()"
    >
      <span class="flag" [class.active]="current() === 'en'" lang="en">
        <svg
          viewBox="0 0 60 30"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <clipPath id="bb-uk-clip">
            <path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z" />
          </clipPath>
          <path d="M0,0v30h60v-30z" fill="#012169" />
          <path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6" />
          <path
            d="M0,0L60,30M60,0L0,30"
            clip-path="url(#bb-uk-clip)"
            stroke="#C8102E"
            stroke-width="4"
          />
          <path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10" />
          <path d="M30,0v30M0,15h60" stroke="#C8102E" stroke-width="6" />
        </svg>
      </span>
      <span class="flag" [class.active]="current() === 'el'" lang="el">
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
    </button>
  `,
  styles: `
    .toggle {
      align-items: center;
      backdrop-filter: blur(8px);
      background: rgb(255 255 255 / 0.78);
      border: 1px solid rgb(16 58 99 / 0.1);
      border-radius: 6px;
      box-shadow: var(--bb-shadow-sm);
      cursor: pointer;
      display: inline-flex;
      gap: 4px;
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

    .flag {
      border-radius: 3px;
      display: block;
      height: 16px;
      opacity: 0.4;
      overflow: hidden;
      transition:
        opacity var(--bb-fast) ease,
        filter var(--bb-fast) ease;
      filter: grayscale(0.6);
      width: 24px;
    }
    .flag.active {
      filter: none;
      opacity: 1;
      box-shadow: 0 0 0 2px var(--bb-sky-500);
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

  /** Emits the newly chosen language (the app saves it for signed-in users). */
  readonly changed = output<Locale>();

  protected readonly current = computed(() => this.language.current());
  protected readonly next = computed<Locale>(() =>
    this.current() === 'el' ? 'en' : 'el',
  );

  protected toggle(): void {
    this.changed.emit(this.next());
  }
}
