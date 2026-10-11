import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { ITEM_FREE_LIMIT } from '@borrowbox/contracts';
import { firstValueFrom } from 'rxjs';
import type { OwnItemResponse } from '../../api/models';
import {
  ConfirmDialog,
  type ConfirmDialogData,
} from '../../shared/confirm-dialog';
import { EurPipe } from '../../shared/format/eur.pipe';
import { cardRate } from '../../shared/format/pricing';
import { MyItemsStore, type ItemAction } from './my-items.store';

/** What a draft still needs before it can be published. */
export function missingForPublish(
  item: OwnItemResponse,
): Array<'location' | 'photo'> {
  const missing: Array<'location' | 'photo'> = [];
  if (!item.location) missing.push('location');
  if (!item.photos.some((p) => p.status === 'READY')) missing.push('photo');
  return missing;
}

/** The first processed photo, as the cover. */
export function coverOf(item: OwnItemResponse): string | null {
  const ready = item.photos
    .filter((p) => p.status === 'READY' && p.urls)
    .sort((a, b) => a.position - b.position);
  return ready[0]?.urls?.small ?? null;
}

/**
 * The lender's items (step 12e): status, one rate, and what can be done
 * next. Rows sit on the background, separated by dividers (no panels).
 */
@Component({
  selector: 'bb-my-items-page',
  imports: [RouterLink, TranslocoDirective, MatButtonModule, EurPipe],
  providers: [MyItemsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *transloco="let t">
      <header class="head">
        <div>
          <h1 class="page-title">{{ t('nav.myItems') }}</h1>
          @if (store.status() === 'ready') {
            <p class="count">
              {{ t('myItems.count', { count: store.count(), max: limit }) }}
            </p>
          }
        </div>
        <a
          mat-flat-button
          routerLink="/my-items/new"
          [class.disabled]="store.atLimit()"
          [attr.aria-disabled]="store.atLimit()"
          [tabindex]="store.atLimit() ? -1 : 0"
        >
          {{ t('myItems.new') }}
        </a>
      </header>
      @if (store.atLimit()) {
        <p class="note">{{ t('errors.ITEM_LIMIT_REACHED') }}</p>
      }

      @switch (store.status()) {
        @case ('loading') {
          <p class="muted">{{ t('listing.loading') }}</p>
        }
        @case ('error') {
          <div class="message" role="alert">
            <p>{{ t('errors.' + store.error()) }}</p>
            <button mat-stroked-button type="button" (click)="store.load()">
              {{ t('explore.retry') }}
            </button>
          </div>
        }
        @default {
          @if (store.count() === 0) {
            <div class="message">
              <p class="strong">{{ t('myItems.empty') }}</p>
              <p>{{ t('myItems.emptyHint') }}</p>
              <a mat-flat-button routerLink="/my-items/new">{{
                t('myItems.first')
              }}</a>
            </div>
          }
          <ul class="list">
            @for (item of store.items(); track item.id) {
              <li class="row">
                <span class="photo">
                  @if (cover(item); as src) {
                    <img [src]="src" alt="" />
                  }
                </span>
                <div class="text">
                  <span class="status" [attr.data-status]="item.status">{{
                    t('myItems.status.' + item.status)
                  }}</span>
                  <strong class="title">{{ item.title }}</strong>
                  <span class="price">
                    @if (rate(item); as r) {
                      @if (r.free) {
                        {{ t('catalog.free') }}
                      } @else {
                        {{ r.rate.cents | eur
                        }}{{ t('catalog.perUnit.' + r.rate.unit) }}
                      }
                    }
                  </span>
                  @if (item.status === 'DRAFT' && missing(item).length > 0) {
                    <span class="needs">
                      {{ t('myItems.needs') }}
                      @for (m of missing(item); track m; let last = $last) {
                        {{ t('myItems.missing.' + m) }}{{ last ? '' : ', ' }}
                      }
                    </span>
                  }
                  <div class="actions">
                    <a
                      mat-button
                      [routerLink]="['/my-items', item.id, 'edit']"
                      >{{ t('item.edit') }}</a
                    >
                    @switch (item.status) {
                      @case ('DRAFT') {
                        <button
                          mat-button
                          type="button"
                          [disabled]="busy(item) || missing(item).length > 0"
                          (click)="run(item, 'publish')"
                        >
                          {{ t('listing.publish') }}
                        </button>
                      }
                      @case ('ACTIVE') {
                        <a mat-button [routerLink]="['/items', item.id]">{{
                          t('myItems.view')
                        }}</a>
                        <button
                          mat-button
                          type="button"
                          [disabled]="busy(item)"
                          (click)="run(item, 'pause')"
                        >
                          {{ t('myItems.pause') }}
                        </button>
                      }
                      @case ('PAUSED') {
                        <button
                          mat-button
                          type="button"
                          [disabled]="busy(item)"
                          (click)="run(item, 'unpause')"
                        >
                          {{ t('myItems.unpause') }}
                        </button>
                      }
                    }
                    <button
                      mat-button
                      type="button"
                      class="delete"
                      [disabled]="busy(item)"
                      (click)="remove(item)"
                    >
                      {{ t('myItems.delete') }}
                    </button>
                  </div>
                </div>
              </li>
            }
          </ul>
        }
      }
    </div>
  `,
  styles: `
    .head {
      align-items: flex-start;
      display: flex;
      gap: 16px;
      justify-content: space-between;
    }
    .page-title {
      font: var(--mat-sys-headline-small);
      margin: 0;
    }
    .count,
    .muted,
    .note {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 4px 0 0;
    }
    .note {
      margin-top: 12px;
    }
    a.disabled {
      opacity: 0.45;
      pointer-events: none;
    }
    .list {
      list-style: none;
      margin: 20px 0 0;
      padding: 0;
    }
    .row {
      border-top: 1px solid rgb(16 58 99 / 0.08);
      display: flex;
      gap: 16px;
      padding: 16px 0;
    }
    .photo {
      background: var(--bb-sky-100);
      flex: none;
      height: 96px;
      overflow: hidden;
      width: 96px;
    }
    .photo img {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .status {
      align-self: flex-start;
      border: 1px solid currentColor;
      font: var(--mat-sys-label-small);
      padding: 1px 6px;
      text-transform: uppercase;
    }
    .status[data-status='ACTIVE'] {
      color: #1e7a3c;
    }
    .status[data-status='DRAFT'] {
      color: var(--mat-sys-on-surface-variant);
    }
    .status[data-status='PAUSED'] {
      color: #9a5b00;
    }
    .title {
      font: var(--mat-sys-title-medium);
      overflow-wrap: anywhere;
    }
    .price {
      font: var(--mat-sys-body-medium);
    }
    .needs {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-left: -12px;
    }
    .delete {
      --mat-button-text-label-text-color: var(--mat-sys-error);
    }
    .message {
      color: var(--mat-sys-on-surface-variant);
      padding: 40px 0;
      text-align: center;
    }
    .message p {
      margin: 0 0 12px;
    }
    .message .strong {
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-title-medium);
    }
  `,
})
export class MyItemsPage implements OnInit {
  protected readonly store = inject(MyItemsStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);

  protected readonly limit = ITEM_FREE_LIMIT;
  protected readonly missing = missingForPublish;
  protected readonly cover = coverOf;
  protected readonly rate = (item: OwnItemResponse) => cardRate(item.pricing);
  protected readonly busy = (item: OwnItemResponse) =>
    this.store.busyId() === item.id;

  ngOnInit(): void {
    void this.store.load();
  }

  protected async run(
    item: OwnItemResponse,
    action: ItemAction,
  ): Promise<void> {
    const failed = await this.store.act(item.id, action);
    if (failed) this.say(`errors.${failed}`);
  }

  protected async remove(item: OwnItemResponse): Promise<void> {
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params);
    const data: ConfirmDialogData = {
      title: t('myItems.deleteTitle'),
      message: t('myItems.deleteMessage', { title: item.title }),
      confirm: t('myItems.delete'),
      cancel: t('myItems.cancel'),
      danger: true,
    };
    const confirmed = await firstValueFrom(
      this.dialog.open(ConfirmDialog, { data }).afterClosed(),
    );
    if (confirmed !== true) return;
    const failed = await this.store.act(item.id, 'delete');
    this.say(failed ? `errors.${failed}` : 'myItems.deleted');
  }

  private say(key: string): void {
    this.snackBar.open(this.transloco.translate(key), undefined, {
      duration: 4000,
    });
  }
}
