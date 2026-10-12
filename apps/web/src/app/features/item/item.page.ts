import { DatePipe, Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { AuthStore } from '../../core/auth/auth.store';
import { LanguageService } from '../../core/i18n/language';
import { Avatar } from '../../shared/avatar/avatar';
import { ResultRow } from '../../shared/catalog/result-row';
import { EurPipe } from '../../shared/format/eur.pipe';
import { offeredRates } from '../../shared/format/pricing';
import { MapView } from '../../shared/map/map-view';
import { ItemGallery } from './item-gallery';
import { ItemStore } from './item.store';

/**
 * An item's public page (step 12c). Anyone can open it. Requests open in
 * Phase 3, so the borrow button is shown but disabled. The map shows only
 * the approximate area (ADR-0007).
 */
@Component({
  selector: 'bb-item-page',
  imports: [
    DatePipe,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    Avatar,
    ResultRow,
    EurPipe,
    MapView,
    ItemGallery,
  ],
  providers: [ItemStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" *transloco="let t">
      <button type="button" class="back" (click)="back()">
        <span class="chevron" aria-hidden="true"></span>
        <span class="bb-text-action">{{ t('item.back') }}</span>
      </button>

      @switch (store.status()) {
        @case ('loading') {
          <div class="skeleton" [attr.aria-label]="t('item.loading')">
            <span class="block photo"></span>
            <span class="block line"></span>
            <span class="block line short"></span>
          </div>
        }
        @case ('error') {
          <div class="message" role="alert">
            @if (store.error() === 'NOT_FOUND') {
              <h1>{{ t('item.notFound') }}</h1>
              <p>{{ t('errors.NOT_FOUND') }}</p>
              <a mat-flat-button routerLink="/explore">{{
                t('item.backToExplore')
              }}</a>
            } @else {
              <p>{{ t('errors.' + store.error()) }}</p>
              <button mat-stroked-button type="button" (click)="reload()">
                {{ t('explore.retry') }}
              </button>
            }
          </div>
        }
        @case ('ready') {
          @if (store.item(); as item) {
            @if (isOwner()) {
              <p class="owner-note">
                {{ t('item.yours') }}
                <a
                  class="bb-text-action"
                  [routerLink]="['/my-items', item.id, 'edit']"
                  >{{ t('item.edit') }}</a
                >
              </p>
            }

            <div class="layout">
              <bb-item-gallery
                class="gallery"
                [photos]="item.photos"
                [title]="item.title"
              />

              <div class="details">
                @if (item.description) {
                  <section class="section">
                    <h2>{{ t('item.about') }}</h2>
                    <p class="description">{{ item.description }}</p>
                  </section>
                }

                <section class="section">
                  <h2>{{ t('map.approximateArea') }}</h2>
                  <bb-map
                    class="area-map"
                    mode="area"
                    [center]="item.approximateLocation"
                    [area]="item.approximateLocation"
                    [zoom]="14"
                  />
                  <p class="hint">{{ t('item.areaHint') }}</p>
                </section>
              </div>

              <aside class="side">
                <p class="category">
                  {{ t('catalog.categories.' + item.category) }}
                </p>
                <h1 class="title">{{ item.title }}</h1>

                @if (item.pricing.free) {
                  <p class="free">{{ t('catalog.free') }}</p>
                } @else {
                  <dl class="rates">
                    @for (rate of rates(); track rate.unit) {
                      <div class="rate">
                        <dt>{{ t('catalog.units.' + rate.unit) }}</dt>
                        <dd>{{ rate.cents | eur }}</dd>
                      </div>
                    }
                  </dl>
                }

                <div class="deposit">
                  <span>{{ t('item.deposit') }}</span>
                  <strong>{{
                    item.depositCents > 0
                      ? (item.depositCents | eur)
                      : t('item.noDeposit')
                  }}</strong>
                </div>
                @if (item.depositCents > 0) {
                  <p class="hint">{{ t('item.depositHint') }}</p>
                }

                <button mat-flat-button type="button" class="cta" disabled>
                  {{ t('item.requestToBorrow') }}
                </button>
                <p class="hint">{{ t('item.requestsSoon') }}</p>

                <div class="lender">
                  <bb-avatar [size]="44" />
                  <div>
                    <span class="label">{{ t('item.lentBy') }}</span>
                    <strong>{{ item.lender.displayName }}</strong>
                  </div>
                </div>
                <p class="listed">
                  {{
                    t('item.listedOn', {
                      date:
                        (item.publishedAt
                        | date
                          : 'longDate'
                          : undefined
                          : language.formatLocale()),
                    })
                  }}
                </p>
              </aside>
            </div>

            @if (store.similar().length > 0) {
              <section class="similar">
                <h2>{{ t('item.similar') }}</h2>
                @for (s of store.similar(); track s.id) {
                  <bb-result-row [item]="s" />
                }
              </section>
            }
          }
        }
      }
    </div>
  `,
  styles: `
    .back {
      align-items: center;
      background: none;
      border: 0;
      border-radius: var(--bb-button-radius);
      color: var(--bb-sky-700);
      cursor: pointer;
      display: inline-flex;
      font: var(--mat-sys-label-large);
      gap: 8px;
      margin: 0 0 16px;
      padding: 8px 0;
    }
    .chevron {
      border-bottom: 2px solid currentColor;
      border-left: 2px solid currentColor;
      height: 7px;
      transform: rotate(45deg);
      width: 7px;
    }
    .owner-note {
      background: var(--bb-sky-100);
      margin: 0 0 16px;
      padding: 10px 14px;
    }
    .owner-note a {
      color: var(--bb-sky-700);
      font-weight: 700;
      margin-left: 8px;
    }

    /* Phones: photos, then title and price, then the rest. Wide: the
       title column stays beside photos and details. */
    .layout {
      display: grid;
      gap: 24px;
      grid-template-areas: 'gallery' 'side' 'details';
    }
    .gallery {
      grid-area: gallery;
    }
    .side {
      grid-area: side;
    }
    .details {
      grid-area: details;
    }
    @media (min-width: 1180px) {
      .layout {
        column-gap: 32px;
        grid-template-areas: 'gallery side' 'details side';
        grid-template-columns: minmax(0, 1fr) 300px;
        grid-template-rows: auto 1fr;
      }
      .side {
        align-self: start;
        position: sticky;
        top: 24px;
      }
    }
    .section + .section {
      margin-top: 32px;
    }
    h2 {
      font: var(--mat-sys-title-large);
      margin: 0 0 12px;
    }
    .description {
      margin: 0;
      overflow-wrap: anywhere;
      white-space: pre-line;
    }
    .area-map {
      height: 280px;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 6px 0 0;
    }

    .category {
      color: var(--bb-sky-700);
      font: var(--mat-sys-label-large);
      margin: 0 0 4px;
    }
    .title {
      font: var(--mat-sys-headline-medium);
      font-weight: 700;
      margin: 0 0 16px;
      overflow-wrap: anywhere;
    }
    .free {
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      margin: 0 0 16px;
    }
    .rates {
      margin: 0 0 16px;
    }
    .rate,
    .deposit {
      border-bottom: 1px solid rgb(16 58 99 / 0.08);
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
    }
    .rate dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .rate dd {
      font-weight: 700;
      margin: 0;
    }
    .cta {
      margin-top: 20px;
      width: 100%;
    }
    .lender {
      align-items: center;
      border-top: 1px solid rgb(16 58 99 / 0.08);
      display: flex;
      gap: 12px;
      margin-top: 24px;
      padding-top: 16px;
    }
    .lender div {
      display: flex;
      flex-direction: column;
    }
    .lender .label,
    .listed {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .listed {
      margin: 12px 0 0;
    }

    .similar {
      margin-top: 40px;
    }
    .similar h2 {
      border-bottom: 1px solid rgb(16 58 99 / 0.08);
      margin: 0;
      padding-bottom: 12px;
    }

    .message {
      padding: 48px 0;
      text-align: center;
    }
    .message h1 {
      font: var(--mat-sys-headline-small);
      margin: 0 0 8px;
    }
    .message p {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 20px;
    }
    .skeleton {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .block {
      background: rgb(16 58 99 / 0.07);
      display: block;
    }
    .block.photo {
      aspect-ratio: 4 / 3;
      max-width: 640px;
    }
    .block.line {
      height: 20px;
      width: 60%;
    }
    .block.line.short {
      width: 35%;
    }
  `,
})
export class ItemPage {
  /** From the route (`/items/:id`). */
  readonly id = input.required<string>();

  protected readonly store = inject(ItemStore);
  protected readonly language = inject(LanguageService);
  private readonly auth = inject(AuthStore);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);

  protected readonly rates = computed(() => {
    const item = this.store.item();
    return item ? offeredRates(item.pricing) : [];
  });
  protected readonly isOwner = computed(
    () =>
      this.store.item() !== null &&
      this.auth.user()?.id === this.store.item()?.lender.id,
  );

  constructor() {
    effect(() => void this.store.load(this.id()));
    effect(() => {
      const item = this.store.item();
      this.title.setTitle(
        item
          ? `${item.title} · ${this.transloco.translate('app.name')}`
          : this.transloco.translate('app.name'),
      );
    });
    inject(DestroyRef).onDestroy(() =>
      this.title.setTitle(this.transloco.translate('app.name')),
    );
  }

  protected reload(): void {
    void this.store.load(this.id());
  }

  /**
   * Back to where the visitor came from, so Explore keeps its search (E10);
   * straight to Explore when the page was opened directly.
   */
  protected back(): void {
    const state = this.location.getState() as { navigationId?: number } | null;
    if ((state?.navigationId ?? 1) > 1) {
      this.location.back();
    } else {
      void this.router.navigateByUrl('/explore');
    }
  }
}
