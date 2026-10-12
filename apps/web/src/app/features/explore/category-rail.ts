import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { ITEM_CATEGORIES, type ItemCategory } from '@borrowbox/contracts';
import { categoryColor } from '../../shared/catalog/category-colors';
import { ExploreStore } from './explore.store';

/**
 * Explore's left rail on wide screens: every category in its colour, a
 * quicker way to set the Category filter (the same filter, kept in sync).
 */
@Component({
  selector: 'bb-category-rail',
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav *transloco="let t" [attr.aria-label]="t('explore.rails.categories')">
      <h2>{{ t('explore.rails.categories') }}</h2>
      <ul>
        <li>
          <button
            type="button"
            class="category"
            [class.chosen]="store.filters().category === null"
            [attr.aria-pressed]="store.filters().category === null"
            (click)="choose(null)"
          >
            <span class="swatch all"></span>
            {{ t('explore.allCategories') }}
          </button>
        </li>
        @for (c of categories; track c) {
          <li>
            <button
              type="button"
              class="category"
              [style.--cat]="color(c)"
              [class.chosen]="store.filters().category === c"
              [attr.aria-pressed]="store.filters().category === c"
              (click)="choose(c)"
            >
              <span class="swatch"></span>
              {{ t('catalog.categories.' + c) }}
            </button>
          </li>
        }
      </ul>
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    h2 {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
      letter-spacing: 0.6px;
      margin: 0 0 10px;
      padding: 0 10px;
      text-transform: uppercase;
    }
    ul {
      display: flex;
      flex-direction: column;
      gap: 2px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .category {
      --cat: var(--bb-sky-700);
      align-items: center;
      background: none;
      border: 0;
      border-radius: var(--bb-button-radius);
      color: var(--mat-sys-on-surface);
      cursor: pointer;
      display: flex;
      font: var(--mat-sys-body-large);
      font-size: 15px;
      gap: 10px;
      line-height: 20px;
      /* Shorter rows on shorter screens, so the whole list always fits. */
      padding: clamp(2px, 0.55vh, 7px) 10px;
      text-align: left;
      transition:
        background-color var(--bb-fast) var(--bb-ease),
        color var(--bb-fast) var(--bb-ease);
      width: 100%;
    }
    .category:hover {
      color: var(--cat);
    }
    .category:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: -3px;
    }
    .category.chosen {
      background: color-mix(in srgb, var(--cat) 7%, white);
      color: var(--cat);
      font-weight: 600;
    }
    .swatch {
      background: var(--cat);
      flex: none;
      height: 10px;
      width: 10px;
    }
    /* "All": every colour at once. */
    .swatch.all {
      background: conic-gradient(
        #b91c1c,
        #b45309,
        #15803d,
        #0e7490,
        #4338ca,
        #a21caf,
        #b91c1c
      );
    }
  `,
})
export class CategoryRail {
  protected readonly store = inject(ExploreStore);
  protected readonly categories = ITEM_CATEGORIES;
  protected readonly color = categoryColor;

  protected choose(category: ItemCategory | null): void {
    void this.store.setFilters({ category });
  }
}
