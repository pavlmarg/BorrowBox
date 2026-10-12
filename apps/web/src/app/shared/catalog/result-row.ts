import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import type { PublicItemSummaryResponse } from '../../api/models';
import { NavIcon } from '../../core/layout/nav-icon';
import { EurPipe } from '../format/eur.pipe';
import { cardRate } from '../format/pricing';
import { categoryColor } from './category-colors';

/**
 * One search result (E7, E12); only its title links to the item: photo on the left; the category (in its
 * colour), title, the description's start, one rate and the distance band
 * on the right. No panel (E8): rows sit on the background,
 * separated by dividers, tinted when picked on the map.
 */
@Component({
  selector: 'bb-result-row',
  imports: [RouterLink, TranslocoDirective, EurPipe, NavIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="row"
      *transloco="let t"
      [class.selected]="selected()"
      [style.--cat]="color()"
      (mouseenter)="hovered.emit(item().id)"
      (mouseleave)="hovered.emit(null)"
      (focusin)="hovered.emit(item().id)"
      (focusout)="hovered.emit(null)"
    >
      <span class="photo">
        @if (item().coverPhoto; as cover) {
          <img
            [src]="cover.small"
            [attr.srcset]="cover.small + ' 320w, ' + cover.medium + ' 800w'"
            sizes="120px"
            loading="lazy"
            alt=""
          />
        }
      </span>
      <span class="text">
        <span class="category">{{
          t('catalog.categories.' + item().category)
        }}</span>
        <a class="title" [routerLink]="['/items', item().id]">{{
          item().title
        }}</a>
        @if (item().descriptionExcerpt) {
          <span class="description">{{ item().descriptionExcerpt }}</span>
        }
        <span class="price">
          @if (rate(); as r) {
            @if (r.free) {
              {{ t('catalog.free') }}
            } @else {
              <strong>{{ r.rate.cents | eur }}</strong
              >{{ t('catalog.perUnit.' + r.rate.unit) }}
              @if (r.moreRates > 0) {
                <span class="more">
                  · {{ t('catalog.moreRates', { count: r.moreRates }) }}</span
                >
              }
            }
          }
        </span>
        <span class="chip">
          <bb-nav-icon name="location" />
          {{ t('catalog.distance.' + item().distanceBand) }}
        </span>
      </span>
    </div>
  `,
  styles: `
    :host {
      border-bottom: 1px solid rgb(16 58 99 / 0.08);
      display: block;
    }
    .row {
      color: inherit;
      display: flex;
      gap: 14px;
      padding: 12px 16px;
      transition: background-color var(--bb-fast) var(--bb-ease);
    }
    /* Picked on the map. Hovering a row selects it too (for the map), but
       the row itself stays as it is: only its title reacts. */
    .row.selected:not(:hover):not(:focus-within) {
      background: var(--bb-sky-100);
    }
    .photo {
      background: var(--bb-sky-100);
      flex: none;
      height: 120px;
      overflow: hidden;
      width: 120px;
    }
    img {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .text {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    /* The row's one link: underlined, in the category's colour on hover. */
    .title {
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      align-self: flex-start;
      color: inherit;
      display: -webkit-box;
      font: var(--mat-sys-title-medium);
      font-size: 18px;
      line-height: 24px;
      overflow: hidden;
      text-decoration: underline;
      text-decoration-color: currentColor;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
      transition: color var(--bb-fast) var(--bb-ease);
    }
    .title:hover {
      color: var(--cat);
      text-decoration-thickness: 2px;
    }
    .title:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .price {
      font: var(--mat-sys-body-medium);
    }
    .price strong {
      font-weight: 700;
    }
    .description {
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      color: var(--mat-sys-on-surface-variant);
      display: -webkit-box;
      font: var(--mat-sys-body-medium);
      overflow: hidden;
    }
    .more {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
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
  `,
})
export class ResultRow {
  readonly item = input.required<PublicItemSummaryResponse>();
  readonly selected = input(false);
  /** The item under the pointer or focus, or null when it leaves. */
  readonly hovered = output<string | null>();

  protected readonly rate = computed(() => cardRate(this.item().pricing));
  protected readonly color = computed(() =>
    categoryColor(this.item().category),
  );
}
