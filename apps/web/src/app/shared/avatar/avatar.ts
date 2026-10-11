import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A person's picture, round. Without a photo (none can be chosen yet) it
 * shows an anonymous silhouette. Decorative: the name is always shown next
 * to it, so it's hidden from screen readers.
 */
@Component({
  selector: 'bb-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[style.--bb-avatar-size.px]': 'size()',
  },
  template: `
    @if (photoUrl(); as url) {
      <img [src]="url" alt="" />
    } @else {
      <svg viewBox="0 0 24 24" class="silhouette">
        <circle cx="12" cy="8.6" r="4.4" />
        <path d="M3.2 24c.6-5.6 4.2-8.8 8.8-8.8s8.2 3.2 8.8 8.8Z" />
      </svg>
    }
  `,
  styles: `
    :host {
      background: #dde3ea;
      border-radius: 50%;
      display: block;
      flex: none;
      height: var(--bb-avatar-size);
      overflow: hidden;
      width: var(--bb-avatar-size);
    }
    img {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .silhouette {
      display: block;
      fill: #9aa6b4;
      height: 100%;
      width: 100%;
    }
  `,
})
export class Avatar {
  /** Null: the silhouette. */
  readonly photoUrl = input<string | null>(null);
  readonly size = input(40);
}
