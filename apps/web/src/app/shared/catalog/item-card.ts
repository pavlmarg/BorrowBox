import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import type { LenderItemResponse } from '../../api/models';
import { EurPipe } from '../format/eur.pipe';
import { cardRate } from '../format/pricing';
import { categoryColor } from './category-colors';

/**
 * A small item card without a distance (ADR-0025): a person's items on
 * their profile and "More from …" on an item page. Looks like the featured
 * carousel's cards; the whole card links to the item. Its width comes from
 * the list it sits in.
 */
@Component({
  selector: 'bb-item-card',
  imports: [RouterLink, TranslocoDirective, EurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      class="card"
      *transloco="let t"
      [routerLink]="['/items', item().id]"
      [style.--cat]="color()"
    >
      <span class="photo">
        @if (item().coverPhoto; as cover) {
          <img
            [src]="cover.small"
            [attr.srcset]="cover.small + ' 320w, ' + cover.medium + ' 800w'"
            sizes="200px"
            loading="lazy"
            alt=""
          />
        }
      </span>
      <span class="category">{{
        t('catalog.categories.' + item().category)
      }}</span>
      <span class="title">{{ item().title }}</span>
      <span class="price">
        @if (rate(); as r) {
          @if (r.free) {
            {{ t('catalog.free') }}
          } @else {
            <strong>{{ r.rate.cents | eur }}</strong
            >{{ t('catalog.perUnit.' + r.rate.unit) }}
          }
        }
      </span>
    </a>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
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
    .category {
      color: var(--cat);
      font: var(--mat-sys-label-small);
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }
  `,
})
export class ItemCard {
  readonly item = input.required<LenderItemResponse>();

  protected readonly rate = computed(() => cardRate(this.item().pricing));
  protected readonly color = computed(() =>
    categoryColor(this.item().category),
  );
}
