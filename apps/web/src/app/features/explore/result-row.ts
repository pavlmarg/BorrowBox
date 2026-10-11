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
import { EurPipe } from '../../shared/format/eur.pipe';
import { cardRate } from '../../shared/format/pricing';

/**
 * One search result (E7, E12): photo on the left; title, one rate and the
 * distance band on the right. No panel (E8): rows sit on the background,
 * separated by dividers, tinted when hovered or selected.
 */
@Component({
  selector: 'bb-result-row',
  imports: [RouterLink, TranslocoDirective, EurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      class="row"
      *transloco="let t"
      [routerLink]="['/items', item().id]"
      [class.selected]="selected()"
      (mouseenter)="hovered.emit(item().id)"
      (mouseleave)="hovered.emit(null)"
      (focus)="hovered.emit(item().id)"
      (blur)="hovered.emit(null)"
    >
      <span class="photo">
        @if (item().coverPhoto; as cover) {
          <img
            [src]="cover.small"
            [attr.srcset]="cover.small + ' 320w, ' + cover.medium + ' 800w'"
            sizes="96px"
            loading="lazy"
            alt=""
          />
        }
      </span>
      <span class="text">
        <span class="title">{{ item().title }}</span>
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
        <span class="distance">{{
          t('catalog.distance.' + item().distanceBand)
        }}</span>
      </span>
    </a>
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
      text-decoration: none;
      transition: background-color var(--bb-fast) var(--bb-ease);
    }
    .row:hover,
    .row.selected {
      background: var(--bb-sky-100);
    }
    .row:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: -3px;
    }
    .photo {
      background: var(--bb-sky-100);
      flex: none;
      height: 96px;
      overflow: hidden;
      width: 96px;
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
      padding-top: 2px;
    }
    .title {
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      display: -webkit-box;
      font: var(--mat-sys-title-medium);
      overflow: hidden;
    }
    .price {
      font: var(--mat-sys-body-medium);
    }
    .price strong {
      font-weight: 700;
    }
    .more,
    .distance {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class ResultRow {
  readonly item = input.required<PublicItemSummaryResponse>();
  readonly selected = input(false);
  /** The item under the pointer or focus, or null when it leaves. */
  readonly hovered = output<string | null>();

  protected readonly rate = computed(() => cardRate(this.item().pricing));
}
