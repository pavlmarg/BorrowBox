import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  ITEM_CATEGORIES,
  PRICE_UNITS,
  RATE_MAX_CENTS,
  RATE_MIN_CENTS,
  SEARCH_RADIUS_KM,
  type ItemCategory,
  type PriceUnit,
  type SearchRadiusKm,
} from '@borrowbox/contracts';
import { NavIcon } from '../../core/layout/nav-icon';
import { CentsInput, centsRange } from '../../shared/format/cents-input';
import { EurPipe } from '../../shared/format/eur.pipe';
import { DEFAULT_FILTERS } from './explore-query';
import { ExploreStore } from './explore.store';

/**
 * The filters as one line of dropdown buttons, like a fashion shop's
 * (category, distance, price, free only). A button whose filter is set is
 * highlighted; on narrow screens the line scrolls sideways. Reads and
 * writes the ExploreStore directly.
 */
@Component({
  selector: 'bb-explore-filters',
  imports: [
    ReactiveFormsModule,
    TranslocoDirective,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    NavIcon,
    CentsInput,
    EurPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="line"
      role="group"
      *transloco="let t"
      [attr.aria-label]="t('explore.filters')"
    >
      <button
        type="button"
        class="filter"
        [class.active]="f().category !== null"
        [matMenuTriggerFor]="categoryMenu"
      >
        {{
          f().category
            ? t('catalog.categories.' + f().category)
            : t('explore.category')
        }}
        <span class="chevron" aria-hidden="true"></span>
      </button>
      <mat-menu #categoryMenu="matMenu" class="bb-drop bb-scroll-menu">
        <button
          mat-menu-item
          type="button"
          [class.chosen-item]="f().category === null"
          (click)="setCategory(null)"
        >
          <span class="option counted" [class.chosen]="f().category === null"
            >{{ t('explore.allCategories') }}
            @if (store.totalCount() !== null) {
              <span class="count">{{ store.totalCount() }}</span>
            }
          </span>
        </button>
        @for (c of categories; track c) {
          <button
            mat-menu-item
            type="button"
            [class.chosen-item]="f().category === c"
            (click)="setCategory(c)"
          >
            <span class="option counted" [class.chosen]="f().category === c"
              >{{ t('catalog.categories.' + c) }}
              @if (store.categoryCounts(); as counts) {
                <span class="count">{{ counts[c] ?? 0 }}</span>
              }
            </span>
          </button>
        }
      </mat-menu>

      <button
        type="button"
        class="filter"
        [class.active]="f().radiusKm !== defaultRadius"
        [matMenuTriggerFor]="radiusMenu"
        [attr.aria-label]="
          t('explore.radius') +
          ': ' +
          t('explore.radiusKm', { km: f().radiusKm })
        "
      >
        {{ t('explore.radiusKm', { km: f().radiusKm }) }}
        <span class="chevron" aria-hidden="true"></span>
      </button>
      <mat-menu #radiusMenu="matMenu" class="bb-drop">
        @for (km of radii; track km) {
          <button
            mat-menu-item
            type="button"
            [class.chosen-item]="f().radiusKm === km"
            (click)="setRadius(km)"
          >
            <span class="option" [class.chosen]="f().radiusKm === km">{{
              t('explore.radiusKm', { km })
            }}</span>
          </button>
        }
      </mat-menu>

      <button
        type="button"
        class="filter"
        [class.active]="priceActive()"
        [disabled]="f().freeOnly"
        [matMenuTriggerFor]="priceMenu"
        #priceTrigger="matMenuTrigger"
        (menuOpened)="openPrice()"
      >
        @if (priceActive()) {
          {{ t('explore.priceUpTo', { price: (f().maxPriceCents | eur) })
          }}{{ t('catalog.perUnit.' + f().priceUnit) }}
        } @else {
          {{ t('explore.price') }}
        }
        <span class="chevron" aria-hidden="true"></span>
      </button>
      <mat-menu #priceMenu="matMenu" class="bb-price-menu bb-drop">
        <!-- Clicks and keys inside must not close the menu. -->
        <form
          class="price-panel"
          (click)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()"
          (submit)="applyPrice($event)"
        >
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>{{ t('explore.maxPrice') }}</mat-label>
            <span matTextPrefix>€&nbsp;</span>
            <input matInput bbCentsInput [formControl]="price" />
            @if (price.hasError('euros')) {
              <mat-error>{{ t('validation.euros') }}</mat-error>
            } @else if (price.hasError('centsRange')) {
              <mat-error>{{
                t('validation.centsRange', {
                  min: (rateMin | eur),
                  max: (rateMax | eur),
                })
              }}</mat-error>
            } @else {
              <mat-hint>{{ t('explore.maxPriceHint') }}</mat-hint>
            }
          </mat-form-field>
          <mat-button-toggle-group
            class="units"
            hideSingleSelectionIndicator
            [value]="unit()"
            [attr.aria-label]="t('explore.priceUnit')"
            (change)="unit.set($event.value)"
          >
            @for (u of units; track u) {
              <mat-button-toggle [value]="u">{{
                t('catalog.units.' + u)
              }}</mat-button-toggle>
            }
          </mat-button-toggle-group>
          <div class="actions">
            <button mat-button type="button" (click)="clearPrice()">
              {{ t('explore.clearPrice') }}
            </button>
            <button mat-flat-button type="submit" [disabled]="price.invalid">
              {{ t('explore.apply') }}
            </button>
          </div>
        </form>
      </mat-menu>

      <button
        type="button"
        class="filter"
        [class.active]="f().freeOnly"
        [attr.aria-pressed]="f().freeOnly"
        (click)="toggleFree()"
      >
        {{ t('explore.freeOnly') }}
      </button>

      @if (activeCount() > 0) {
        <button type="button" class="clear-all" (click)="clearAll()">
          <bb-nav-icon name="close" class="clear-icon" />
          {{ t('explore.clearAll') }}
        </button>
      }
    </div>
  `,
  styles: `
    .line {
      display: flex;
      gap: 8px;
      margin: 0 -16px;
      overflow-x: auto;
      padding: 2px 16px;
      scrollbar-width: none;
    }
    /* Round pills on purpose (asked for), unlike the app's square buttons. */
    .filter,
    .clear-all {
      align-items: center;
      border-radius: 999px;
      cursor: pointer;
      display: inline-flex;
      flex: none;
      font: var(--mat-sys-label-large);
      gap: 8px;
      height: 38px;
      padding: 0 16px;
      white-space: nowrap;
    }
    /* Solid brand blue like the Map button; a filter that is set is
       darker, with a white ring inside. */
    .filter {
      background: var(--mat-sys-primary);
      border: 0;
      box-shadow: var(--bb-shadow-sm);
      color: var(--mat-sys-on-primary);
      font-weight: 600;
      transition:
        background-color 400ms var(--bb-ease),
        box-shadow 400ms var(--bb-ease);
    }
    .filter:hover,
    .filter[aria-expanded='true'] {
      background: color-mix(in srgb, var(--mat-sys-primary) 82%, black);
    }
    .filter.active {
      background: color-mix(in srgb, var(--mat-sys-primary) 70%, black);
      box-shadow:
        inset 0 0 0 2px rgb(255 255 255 / 0.85),
        var(--bb-shadow-sm);
    }
    .filter.active:hover,
    .filter.active[aria-expanded='true'] {
      background: color-mix(in srgb, var(--mat-sys-primary) 60%, black);
    }
    .filter:disabled {
      cursor: default;
      opacity: 0.45;
    }
    .filter:focus-visible,
    .clear-all:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 1px;
    }
    .chevron {
      border-bottom: 1.5px solid currentColor;
      border-right: 1.5px solid currentColor;
      height: 6px;
      margin-top: -3px;
      transform: rotate(45deg);
      transition:
        transform var(--bb-medium) var(--bb-ease),
        margin var(--bb-medium) var(--bb-ease);
      width: 6px;
    }
    /* Points up while its menu is open. */
    .filter[aria-expanded='true'] .chevron {
      margin-top: 3px;
      transform: rotate(225deg);
    }
    .clear-all {
      background: none;
      border: 0;
      color: var(--bb-sky-700);
    }
    .clear-icon {
      display: inline-flex;
      height: 16px;
      width: 16px;
    }
    .option.chosen {
      font-weight: 700;
    }
    /* The name, and how many results it gives on the right. */
    .option.counted {
      align-items: center;
      display: flex;
      gap: 16px;
      justify-content: space-between;
      min-width: 200px;
    }
    .count {
      font: var(--mat-sys-label-medium);
      font-variant-numeric: tabular-nums;
      opacity: 0.75;
    }
    .price-panel {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px 16px 8px;
      width: 320px;
    }
    .units mat-button-toggle {
      flex: 1;
    }
    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
  `,
})
export class ExploreFilters {
  protected readonly store = inject(ExploreStore);
  protected readonly f = this.store.filters;
  private readonly priceTrigger = viewChild<MatMenuTrigger>('priceTrigger');

  protected readonly categories = ITEM_CATEGORIES;
  protected readonly radii = SEARCH_RADIUS_KM;
  protected readonly units = PRICE_UNITS;
  protected readonly rateMin = RATE_MIN_CENTS;
  protected readonly rateMax = RATE_MAX_CENTS;
  protected readonly defaultRadius = DEFAULT_FILTERS.radiusKm;

  /** The price menu's draft, applied with "Apply". */
  protected readonly price = new FormControl<number | null>(null, [
    centsRange(RATE_MIN_CENTS, RATE_MAX_CENTS),
  ]);
  protected readonly unit = signal<PriceUnit>(DEFAULT_FILTERS.priceUnit);

  protected readonly priceActive = computed(
    () => this.f().maxPriceCents !== null && !this.f().freeOnly,
  );
  protected readonly activeCount = computed(() => {
    const f = this.f();
    return [
      f.category !== null,
      f.radiusKm !== DEFAULT_FILTERS.radiusKm,
      f.freeOnly,
      f.maxPriceCents !== null,
    ].filter(Boolean).length;
  });

  protected setCategory(category: ItemCategory | null): void {
    void this.store.setFilters({ category });
  }

  protected setRadius(radiusKm: SearchRadiusKm): void {
    void this.store.setFilters({ radiusKm });
  }

  protected toggleFree(): void {
    void this.store.setFilters({ freeOnly: !this.f().freeOnly });
  }

  /** The menu starts from what's applied. */
  protected openPrice(): void {
    this.price.reset(this.f().maxPriceCents);
    this.unit.set(this.f().priceUnit);
  }

  protected applyPrice(event: Event): void {
    event.preventDefault();
    if (this.price.invalid) return;
    void this.store.setFilters({
      maxPriceCents: this.price.value,
      priceUnit: this.unit(),
    });
    this.priceTrigger()?.closeMenu();
  }

  protected clearPrice(): void {
    this.price.reset(null);
    void this.store.setFilters({ maxPriceCents: null });
    this.priceTrigger()?.closeMenu();
  }

  protected clearAll(): void {
    void this.store.setFilters({
      category: null,
      radiusKm: DEFAULT_FILTERS.radiusKm,
      freeOnly: false,
      maxPriceCents: null,
    });
  }
}
