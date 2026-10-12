import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type NavIconName =
  | 'explore'
  | 'items'
  | 'rentals'
  | 'messages'
  | 'profile'
  | 'settings'
  | 'logout'
  | 'login'
  | 'register'
  | 'menu'
  | 'search'
  | 'filter'
  | 'map'
  | 'list'
  | 'location'
  | 'check'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'trash'
  | 'pause'
  | 'play';

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
        @case ('login') {
          <path
            d="M14.5 3.5H19a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-4.5"
          />
          <path d="m9.5 16.5 4.5-4.5-4.5-4.5M14 12H3.5" />
        }
        @case ('register') {
          <circle cx="10" cy="8.5" r="4" />
          <path d="M2.5 20.5c1.1-3.4 4-5.5 7.5-5.5 1.6 0 3 .4 4.2 1.1" />
          <path d="M18.5 14v6M15.5 17h6" />
        }
        @case ('search') {
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        }
        @case ('filter') {
          <path d="M4 6.5h16M7 12h10M10 17.5h4" />
        }
        @case ('map') {
          <path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2Z" />
          <path d="M9 4.5v13M15 6.5v13" />
        }
        @case ('list') {
          <path d="M9 6.5h11M9 12h11M9 17.5h11" />
          <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
        }
        @case ('location') {
          <circle cx="12" cy="12" r="3.5" />
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" />
        }
        @case ('check') {
          <path d="m4.5 12.5 5 5 10-11" />
        }
        @case ('menu') {
          <path d="M4 6.5h16M4 12h16M4 17.5h16" />
        }
        @case ('close') {
          <path d="m6 6 12 12M18 6 6 18" />
        }
        @case ('chevron-left') {
          <path d="m14.5 6-6 6 6 6" />
        }
        @case ('chevron-right') {
          <path d="m9.5 6 6 6-6 6" />
        }
        @case ('trash') {
          <!-- The body, then the lid a little above it. -->
          <path d="M10 11.5v5.5M14 11.5v5.5" />
          <path
            d="M6 8.5l1 11a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5l1-11Z"
          />
          <g class="lid">
            <path d="M4.5 6h15M9 6V3.5h6V6" />
          </g>
        }
        @case ('chevron-down') {
          <path d="m6 9.5 6 6 6-6" />
        }
        @case ('pause') {
          <path d="M9 6v12M15 6v12" />
        }
        @case ('play') {
          <path d="M8 5.5v13l10-6.5-10-6.5Z" />
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
      /* Moving parts (the bin's lid) may leave the 24 × 24 box. */
      overflow: visible;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      /* A parent may draw an icon bolder, e.g. on hover. */
      stroke-width: var(--bb-icon-stroke, 1.7);
      transition: stroke-width 300ms var(--bb-ease);
      width: 100%;
    }
    /* The bin's lid opens 30° on its right-hand hinge while a parent marked
       bb-lid-trigger is pointed at or focused. */
    .lid {
      transform-box: view-box;
      transform-origin: 19.5px 6px;
      /* Closing: a soft settle. */
      transition: transform 260ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    :host-context(.bb-lid-trigger:not([disabled]):hover) .lid,
    :host-context(.bb-lid-trigger:focus-visible) .lid {
      transform: rotate(30deg);
      /* Opening: a little spring past 30° and back. */
      transition: transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
  `,
})
export class NavIcon {
  readonly name = input.required<NavIconName>();
}
