import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import type { PublicItemSummaryResponse } from '../../api/models';
import { NavIcon } from '../../core/layout/nav-icon';
import { EurPipe } from '../../shared/format/eur.pipe';
import { cardRate } from '../../shared/format/pricing';
import { categoryColor } from '../../shared/catalog/category-colors';

/** Moves on by one card this often… */
export const ADVANCE_EVERY_MS = 5000;
/** …and waits this long after the user swiped or used an arrow. */
export const RESUME_AFTER_MS = 10000;
/** Space between cards, in px (also in the styles). */
const GAP_PX = 12;

/**
 * Featured items above Explore's results: a row of cards that moves on by
 * itself every few seconds, with ‹ › arrows on both sides. It stops while
 * pointed at or focused, for a while after the user moved it, when paused
 * with its button (WCAG 2.2.2), and never moves by itself for people who
 * asked for reduced motion.
 */
@Component({
  selector: 'bb-featured-carousel',
  imports: [RouterLink, TranslocoDirective, EurPipe, NavIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:resize)': 'updateEnds()' },
  template: `
    <section
      class="featured"
      *transloco="let t"
      aria-roledescription="carousel"
      [attr.aria-label]="t('explore.featured.title')"
      (focusin)="focused = true"
      (focusout)="focused = false"
    >
      <div class="heading">
        <h2>{{ t('explore.featured.title') }}</h2>
        @if (scrollable() && !reducedMotion()) {
          <button
            type="button"
            class="pause"
            [attr.aria-label]="
              t(
                userPaused()
                  ? 'explore.featured.play'
                  : 'explore.featured.pause'
              )
            "
            (click)="userPaused.set(!userPaused())"
          >
            <bb-nav-icon [name]="userPaused() ? 'play' : 'pause'" />
          </button>
        }
      </div>

      <div
        class="viewport"
        (mouseenter)="hovering = true"
        (mouseleave)="hovering = false"
      >
        <ul
          class="track"
          #track
          (scroll)="updateEnds()"
          (touchstart)="holdOff()"
          (wheel)="holdOff()"
        >
          @for (item of items(); track item.id) {
            <li>
              <a
                class="card"
                [routerLink]="['/items', item.id]"
                [style.--cat]="colorOf(item)"
              >
                <span class="photo">
                  @if (item.coverPhoto; as cover) {
                    <img
                      [src]="cover.small"
                      [attr.srcset]="
                        cover.small + ' 320w, ' + cover.medium + ' 800w'
                      "
                      sizes="168px"
                      loading="lazy"
                      alt=""
                    />
                  }
                </span>
                <span class="category">{{
                  t('catalog.categories.' + item.category)
                }}</span>
                <span class="title">{{ item.title }}</span>
                <span class="price">
                  @if (rateOf(item); as r) {
                    @if (r.free) {
                      {{ t('catalog.free') }}
                    } @else {
                      <strong>{{ r.rate.cents | eur }}</strong
                      >{{ t('catalog.perUnit.' + r.rate.unit) }}
                    }
                  }
                </span>
                <span class="chip">
                  <bb-nav-icon name="location" />
                  {{ t('catalog.distance.' + item.distanceBand) }}
                </span>
              </a>
            </li>
          }
        </ul>

        @if (scrollable()) {
          <button
            type="button"
            class="arrow prev"
            [disabled]="!autoplay() && atStart()"
            [attr.aria-label]="t('explore.featured.previous')"
            (click)="step(-1)"
          >
            <bb-nav-icon name="chevron-left" />
          </button>
          <button
            type="button"
            class="arrow next"
            [disabled]="!autoplay() && atEnd()"
            [attr.aria-label]="t('explore.featured.next')"
            (click)="step(1)"
          >
            <bb-nav-icon name="chevron-right" />
          </button>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      border-bottom: 1px solid rgb(16 58 99 / 0.08);
      display: block;
      padding: 16px 0 18px;
    }
    .heading {
      align-items: center;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      padding: 0 16px 10px;
    }
    h2 {
      font: var(--mat-sys-title-medium);
      margin: 0;
    }
    .pause {
      align-items: center;
      background: none;
      border: 0;
      border-radius: var(--bb-button-radius);
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
      display: inline-flex;
      height: 32px;
      justify-content: center;
      padding: 0;
      width: 32px;
    }
    .pause bb-nav-icon {
      height: 18px;
      width: 18px;
    }
    .viewport {
      position: relative;
    }
    .track {
      display: flex;
      gap: 12px;
      list-style: none;
      /* Inset by a margin, not padding: padding would scroll with the
         cards and show a sliver of the previous one. */
      margin: 0 16px;
      overflow-x: auto;
      padding: 0;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
    }
    .track::-webkit-scrollbar {
      display: none;
    }
    li {
      flex: none;
      scroll-snap-align: start;
      width: 168px;
    }
    .card {
      color: inherit;
      display: flex;
      flex-direction: column;
      gap: 4px;
      text-decoration: none;
    }
    .card:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .photo {
      aspect-ratio: 1;
      background: var(--bb-sky-100);
      display: block;
      margin-bottom: 4px;
      overflow: hidden;
    }
    img {
      display: block;
      height: 100%;
      object-fit: cover;
      transition: transform var(--bb-medium) var(--bb-ease);
      width: 100%;
    }
    .card:hover img {
      transform: scale(1.04);
    }
    /* Underlined like a result's title; the whole card is the link. */
    .title {
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      display: -webkit-box;
      font: var(--mat-sys-title-small);
      font-size: 16px;
      line-height: 22px;
      overflow: hidden;
      text-decoration: underline;
      text-decoration-color: currentColor;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
      transition: color var(--bb-fast) var(--bb-ease);
    }
    .card:hover .title,
    .card:focus-visible .title {
      color: var(--cat);
      text-decoration-thickness: 2px;
    }
    .price {
      font: var(--mat-sys-body-medium);
    }
    .price strong {
      font-weight: 700;
    }
    /* The distance as a chip, tinted with the category's colour. */
    .chip {
      align-items: center;
      align-self: flex-start;
      background: color-mix(in srgb, var(--cat) 7%, white);
      border-radius: var(--bb-button-radius);
      color: var(--cat);
      display: inline-flex;
      font: var(--mat-sys-label-medium);
      gap: 4px;
      padding: 2px 8px 2px 5px;
    }
    .chip bb-nav-icon {
      height: 14px;
      width: 14px;
    }
    .category {
      color: var(--cat);
      font: var(--mat-sys-label-small);
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }
    /* Round on purpose, centred on the photos, over the row's edges. */
    .arrow {
      align-items: center;
      background: #fff;
      border: 0;
      border-radius: 50%;
      box-shadow: var(--bb-shadow-md);
      color: var(--bb-sky-700);
      cursor: pointer;
      display: inline-flex;
      height: 40px;
      justify-content: center;
      padding: 0;
      position: absolute;
      top: 64px;
      transition:
        background-color var(--bb-medium) var(--bb-ease),
        opacity var(--bb-medium) var(--bb-ease);
      width: 40px;
      z-index: 1;
    }
    .arrow:hover:not([disabled]) {
      background: var(--bb-sky-50);
    }
    .arrow[disabled] {
      cursor: default;
      opacity: 0;
      pointer-events: none;
    }
    .arrow:focus-visible,
    .pause:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .arrow bb-nav-icon {
      height: 22px;
      width: 22px;
    }
    .prev {
      left: 6px;
    }
    .next {
      right: 6px;
    }
  `,
})
export class FeaturedCarousel {
  readonly items = input.required<PublicItemSummaryResponse[]>();

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  /** Stopped with the pause button. */
  protected readonly userPaused = signal(false);
  protected readonly reducedMotion = signal(
    this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches ?? false,
  );
  /** Moves by itself; the arrows then wrap around at the ends. */
  protected readonly autoplay = computed(
    () => !this.userPaused() && !this.reducedMotion(),
  );
  protected readonly atStart = signal(true);
  protected readonly atEnd = signal(true);
  /** More cards than fit: arrows, pause button and moving make sense. */
  protected readonly scrollable = computed(
    () => !(this.atStart() && this.atEnd()),
  );

  protected hovering = false;
  protected focused = false;
  /** No moving by itself before this time (ms since epoch). */
  private resumeAt = 0;

  constructor() {
    const win = this.document.defaultView;
    // New items: back to the first card.
    effect(() => {
      this.items();
      const track = this.track()?.nativeElement;
      if (track) track.scrollLeft = 0;
      win?.requestAnimationFrame(() => this.updateEnds());
    });
    afterNextRender(() => {
      this.updateEnds();
      const timer = win?.setInterval(() => this.advance(), ADVANCE_EVERY_MS);
      this.destroyRef.onDestroy(() => win?.clearInterval(timer));
    });
  }

  protected rateOf(item: PublicItemSummaryResponse) {
    return cardRate(item.pricing);
  }

  protected colorOf(item: PublicItemSummaryResponse): string {
    return categoryColor(item.category);
  }

  /** An arrow: one card on, and a break from moving by itself. */
  protected step(direction: 1 | -1): void {
    this.holdOff();
    this.move(direction);
  }

  protected holdOff(): void {
    this.resumeAt = Date.now() + RESUME_AFTER_MS;
  }

  protected updateEnds(): void {
    const track = this.track()?.nativeElement;
    if (!track) return;
    this.atStart.set(track.scrollLeft <= 1);
    this.atEnd.set(
      track.scrollLeft + track.clientWidth >= track.scrollWidth - 1,
    );
  }

  /** The timer's tick: moves on unless something says to wait. */
  advance(): void {
    if (
      !this.autoplay() ||
      !this.scrollable() ||
      this.hovering ||
      this.focused ||
      this.document.hidden ||
      Date.now() < this.resumeAt
    ) {
      return;
    }
    this.move(1);
  }

  private move(direction: 1 | -1): void {
    const track = this.track()?.nativeElement;
    if (!track) return;
    this.updateEnds();
    const behavior: ScrollBehavior = this.reducedMotion() ? 'auto' : 'smooth';
    if (direction === 1 && this.atEnd()) {
      if (this.autoplay()) track.scrollTo({ left: 0, behavior });
      return;
    }
    if (direction === -1 && this.atStart()) {
      if (this.autoplay()) {
        track.scrollTo({ left: track.scrollWidth, behavior });
      }
      return;
    }
    const width = track.querySelector('li')?.getBoundingClientRect().width;
    const stepPx = width ? width + GAP_PX : track.clientWidth;
    track.scrollBy({ left: direction * stepPx, behavior });
  }
}
