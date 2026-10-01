import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type NavIconName =
  | 'explore'
  | 'items'
  | 'rentals'
  | 'messages'
  | 'profile'
  | 'settings'
  | 'logout'
  | 'menu'
  | 'close';

/** Outline icons as inline SVG: no icon font, nothing loaded from a CDN. */
@Component({
  selector: 'bb-nav-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (name()) {
        @case ('explore') {
          <circle cx="12" cy="12" r="9" />
          <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
        }
        @case ('items') {
          <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
          <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
        }
        @case ('rentals') {
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
          <path d="m9 15 2 2 4-4" />
        }
        @case ('messages') {
          <path
            d="M20.5 12c0 4.1-3.8 7.5-8.5 7.5-1.3 0-2.6-.3-3.7-.8L3.5 20l1.4-3.6C4 15.2 3.5 13.7 3.5 12c0-4.1 3.8-7.5 8.5-7.5s8.5 3.4 8.5 7.5Z"
          />
        }
        @case ('profile') {
          <circle cx="12" cy="8.5" r="4" />
          <path d="M4 20.5c1.2-3.6 4.3-5.5 8-5.5s6.8 1.9 8 5.5" />
        }
        @case ('settings') {
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
          />
        }
        @case ('logout') {
          <path
            d="M9.5 20.5H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h4.5"
          />
          <path d="m15.5 16.5 4.5-4.5-4.5-4.5M20 12H9.5" />
        }
        @case ('menu') {
          <path d="M4 6.5h16M4 12h16M4 17.5h16" />
        }
        @case ('close') {
          <path d="m6 6 12 12M18 6 6 18" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      height: 24px;
      width: 24px;
    }
    svg {
      fill: none;
      height: 100%;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.7;
      width: 100%;
    }
  `,
})
export class NavIcon {
  readonly name = input.required<NavIconName>();
}
