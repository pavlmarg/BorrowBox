import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatStepper, MatStepperModule } from '@angular/material/stepper';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  DEPOSIT_MAX_CENTS,
  DEPOSIT_MIN_CENTS,
  ITEM_CATEGORIES,
  ITEM_DESCRIPTION_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  ITEM_TITLE_MIN_LENGTH,
  PRICE_UNITS,
  RATE_MAX_CENTS,
  RATE_MIN_CENTS,
  charLength,
  type GeoPoint,
} from '@borrowbox/contracts';
import { map } from 'rxjs';
import { NavIcon } from '../../core/layout/nav-icon';
import { CentsInput } from '../../shared/format/cents-input';
import { EurPipe } from '../../shared/format/eur.pipe';
import {
  GeolocationError,
  GeolocationService,
} from '../../shared/geo/geolocation';
import { DEFAULT_CENTER, distanceM } from '../../shared/map/geo';
import { MapView } from '../../shared/map/map-view';
import {
  basicsForm,
  createBody,
  fillForms,
  pricingForm,
  pricingIsValid,
  updateBody,
} from './listing-forms';
import { ListingStore } from './listing.store';
import { PhotosStep } from './photos-step';

const WIDE = '(min-width: 760px)';

/**
 * The listing wizard (step 12d): `/my-items/new` and `/my-items/:id/edit`.
 * A new item's id is chosen here and the draft is created once its price
 * is set (the API needs a rate card), so retries never make duplicates.
 * Each "Next" saves only what changed.
 */
@Component({
  selector: 'bb-listing-wizard',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatStepperModule,
    NavIcon,
    CentsInput,
    EurPipe,
    MapView,
    PhotosStep,
  ],
  providers: [ListingStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *transloco="let t">
      <a class="back" routerLink="/my-items">
        <span class="chevron" aria-hidden="true"></span>
        {{ t('listing.backToItems') }}
      </a>
      <h1 class="page-title">
        {{ t(editing() ? 'listing.editTitle' : 'listing.newTitle') }}
      </h1>

      @if (store.status() === 'loading') {
        <p class="muted">{{ t('listing.loading') }}</p>
      } @else if (store.status() === 'error') {
        <p class="error" role="alert">{{ t('errors.' + store.error()) }}</p>
      } @else {
        @if (store.error(); as code) {
          <p class="error" role="alert">{{ t('errors.' + code) }}</p>
        }
        <mat-stepper
          #stepper
          class="bb-steps"
          [linear]="!editing()"
          [orientation]="wide() ? 'horizontal' : 'vertical'"
          (selectionChange)="store.clearError()"
        >
          <!-- Our own step icons: Material's default ones need an icon font. -->
          <ng-template matStepperIcon="edit" let-index="index">{{
            index + 1
          }}</ng-template>
          <ng-template matStepperIcon="done" let-index="index">{{
            index + 1
          }}</ng-template>
          <!-- 1. Details -->
          <mat-step [stepControl]="basics" [label]="t('listing.stepDetails')">
            <form
              [formGroup]="basics"
              class="form"
              (submit)="$event.preventDefault()"
            >
              <mat-form-field>
                <mat-label>{{ t('listing.title') }}</mat-label>
                <input matInput formControlName="title" required />
                <mat-hint align="end"
                  >{{ titleLength() }} / {{ titleMax }}</mat-hint
                >
                @if (basics.controls.title.invalid) {
                  <mat-error>{{
                    t('listing.titleRule', { min: titleMin, max: titleMax })
                  }}</mat-error>
                }
              </mat-form-field>
              <mat-form-field>
                <mat-label>{{ t('explore.category') }}</mat-label>
                <mat-select formControlName="category" required>
                  @for (c of categories; track c) {
                    <mat-option [value]="c">{{
                      t('catalog.categories.' + c)
                    }}</mat-option>
                  }
                </mat-select>
                @if (basics.controls.category.invalid) {
                  <mat-error>{{ t('validation.required') }}</mat-error>
                }
              </mat-form-field>
              <mat-form-field>
                <mat-label>{{ t('listing.description') }}</mat-label>
                <textarea
                  matInput
                  formControlName="description"
                  rows="5"
                ></textarea>
                <mat-hint>{{ t('listing.descriptionHint') }}</mat-hint>
                <mat-hint align="end"
                  >{{ descriptionLength() }} / {{ descriptionMax }}</mat-hint
                >
                @if (basics.controls.description.invalid) {
                  <mat-error>{{
                    t('listing.descriptionRule', { max: descriptionMax })
                  }}</mat-error>
                }
              </mat-form-field>
              <div class="actions">
                <button mat-flat-button matStepperNext type="button">
                  {{ t('listing.next') }}
                </button>
              </div>
            </form>
          </mat-step>

          <!-- 2. Price -->
          <mat-step
            [completed]="store.item() !== null && pricingSaved()"
            [label]="t('listing.stepPrice')"
          >
            <form
              [formGroup]="pricing"
              class="form"
              (submit)="$event.preventDefault()"
            >
              <mat-slide-toggle formControlName="free">{{
                t('listing.freeToggle')
              }}</mat-slide-toggle>
              @if (!pricing.controls.free.value) {
                <p class="muted">{{ t('listing.ratesIntro') }}</p>
                <div class="rates" formGroupName="rates">
                  @for (u of units; track u) {
                    <mat-form-field floatLabel="always">
                      <mat-label>{{ t('listing.ratePer.' + u) }}</mat-label>
                      <span matTextPrefix>€&nbsp;</span>
                      <input
                        matInput
                        bbCentsInput
                        [formControlName]="u"
                        [attr.data-unit]="u"
                      />
                      @if (pricing.controls.rates.controls[u].invalid) {
                        <mat-error>{{
                          pricing.controls.rates.controls[u].hasError('euros')
                            ? t('validation.euros')
                            : t('validation.centsRange', {
                                min: (rateMin | eur),
                                max: (rateMax | eur),
                              })
                        }}</mat-error>
                      }
                    </mat-form-field>
                  }
                </div>
                @if (pricing.hasError('noRate') && pricing.touched) {
                  <p class="error">{{ t('listing.noRate') }}</p>
                }
              }
              <mat-form-field class="deposit">
                <mat-label>{{ t('item.deposit') }}</mat-label>
                <span matTextPrefix>€&nbsp;</span>
                <input matInput bbCentsInput formControlName="depositCents" />
                <mat-hint>{{ t('listing.depositHint') }}</mat-hint>
                @if (pricing.controls.depositCents.invalid) {
                  <mat-error>{{
                    t('validation.centsRange', {
                      min: (depositMin | eur),
                      max: (depositMax | eur),
                    })
                  }}</mat-error>
                }
              </mat-form-field>
              <div class="actions">
                <button mat-button matStepperPrevious type="button">
                  {{ t('listing.previous') }}
                </button>
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="store.saving()"
                  (click)="savePrice()"
                >
                  {{ t('listing.next') }}
                </button>
              </div>
            </form>
          </mat-step>

          <!-- 3. Location -->
          <mat-step
            [completed]="hasLocation()"
            [label]="t('listing.stepLocation')"
          >
            <p class="muted">{{ t('listing.locationIntro') }}</p>
            <div class="map-tools">
              <button
                mat-stroked-button
                type="button"
                [disabled]="locating()"
                (click)="useMyLocation()"
              >
                <bb-nav-icon name="location" class="button-icon" />
                {{ t('geo.useMyLocation') }}
              </button>
            </div>
            <bb-map
              class="pin-map"
              mode="pin"
              [center]="mapCenter()"
              [zoom]="pin() ? 16 : 12"
              [(pin)]="pin"
              [area]="savedArea()"
            />
            <p class="hint">
              {{ t(pin() ? 'listing.locationPrivacy' : 'listing.dropPin') }}
            </p>
            <div class="actions">
              <button mat-button matStepperPrevious type="button">
                {{ t('listing.previous') }}
              </button>
              <button
                mat-flat-button
                type="button"
                [disabled]="!pin() || store.saving()"
                (click)="saveLocation()"
              >
                {{ t('listing.next') }}
              </button>
            </div>
          </mat-step>

          <!-- 4. Photos -->
          <mat-step
            [completed]="store.readyPhotos() > 0"
            [label]="t('listing.stepPhotos')"
          >
            <bb-photos-step />
            @if (store.readyPhotos() === 0) {
              <p class="muted photo-needed">{{ t('listing.photoNeeded') }}</p>
            }
            <div class="actions">
              <button mat-button matStepperPrevious type="button">
                {{ t('listing.previous') }}
              </button>
              <button
                mat-flat-button
                matStepperNext
                type="button"
                [disabled]="store.readyPhotos() === 0"
              >
                {{ t('listing.next') }}
              </button>
            </div>
          </mat-step>

          <!-- 5. Review -->
          <mat-step [label]="t('listing.stepReview')">
            <ul class="checklist">
              <li [class.done]="store.item() !== null">
                {{ t('listing.checkDetails') }}
              </li>
              <li [class.done]="hasLocation()">
                {{ t('listing.checkLocation') }}
              </li>
              <li [class.done]="store.readyPhotos() > 0">
                {{ t('listing.checkPhoto') }}
              </li>
            </ul>
            @switch (store.item()?.status) {
              @case ('ACTIVE') {
                <p class="muted">{{ t('listing.isActive') }}</p>
              }
              @case ('PAUSED') {
                <p class="muted">{{ t('listing.isPaused') }}</p>
              }
              @default {
                <p class="muted">{{ t('listing.publishIntro') }}</p>
              }
            }
            <div class="actions">
              <button mat-button matStepperPrevious type="button">
                {{ t('listing.previous') }}
              </button>
              @if (store.item()?.status === 'DRAFT' || !store.item()) {
                <button mat-stroked-button type="button" (click)="finish()">
                  {{ t('listing.keepDraft') }}
                </button>
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="!publishable() || store.saving()"
                  (click)="publish()"
                >
                  {{ t('listing.publish') }}
                </button>
              } @else {
                <button mat-flat-button type="button" (click)="finish()">
                  {{ t('listing.done') }}
                </button>
              }
            </div>
          </mat-step>
        </mat-stepper>
      }
    </div>
  `,
  styles: `
    .back {
      align-items: center;
      color: var(--bb-sky-700);
      display: inline-flex;
      font: var(--mat-sys-label-large);
      gap: 8px;
      margin-bottom: 12px;
      text-decoration: none;
    }
    .chevron {
      border-bottom: 2px solid currentColor;
      border-left: 2px solid currentColor;
      height: 7px;
      transform: rotate(45deg);
      width: 7px;
    }
    .page-title {
      font: var(--mat-sys-headline-small);
      margin: 0 0 16px;
    }
    mat-stepper {
      background: transparent;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 560px;
      padding-top: 8px;
    }
    .rates {
      display: grid;
      gap: 0 12px;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    }
    .photo-needed {
      margin: 8px 0 0;
    }
    .deposit {
      margin-top: 8px;
      max-width: 240px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
    .muted,
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 0 0 12px;
    }
    .hint {
      font: var(--mat-sys-body-small);
      margin-top: 8px;
    }
    .error {
      color: var(--mat-sys-error);
      margin: 0 0 12px;
    }
    .map-tools {
      margin-bottom: 8px;
    }
    .button-icon {
      display: inline-flex;
      height: 18px;
      margin-right: 6px;
      vertical-align: -3px;
      width: 18px;
    }
    .pin-map {
      height: 360px;
      max-width: 720px;
    }
    .checklist {
      list-style: none;
      margin: 0 0 16px;
      padding: 0;
    }
    .checklist li {
      color: var(--mat-sys-on-surface-variant);
      padding: 6px 0 6px 28px;
      position: relative;
    }
    .checklist li::before {
      border: 2px solid currentColor;
      content: '';
      height: 12px;
      left: 0;
      position: absolute;
      top: 9px;
      width: 12px;
    }
    .checklist li.done {
      color: var(--mat-sys-on-surface);
    }
    .checklist li.done::before {
      background: var(--bb-sky-700);
      border-color: var(--bb-sky-700);
    }
  `,
})
export class ListingWizardPage {
  /** From the route: present when editing (`/my-items/:id/edit`). */
  readonly id = input<string>();

  protected readonly store = inject(ListingStore);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly geolocation = inject(GeolocationService);
  private readonly stepper = viewChild<MatStepper>('stepper');

  protected readonly basics = basicsForm();
  protected readonly pricing = pricingForm();

  protected readonly categories = ITEM_CATEGORIES;
  protected readonly units = PRICE_UNITS;
  protected readonly titleMin = ITEM_TITLE_MIN_LENGTH;
  protected readonly titleMax = ITEM_TITLE_MAX_LENGTH;
  protected readonly descriptionMax = ITEM_DESCRIPTION_MAX_LENGTH;
  protected readonly rateMin = RATE_MIN_CENTS;
  protected readonly rateMax = RATE_MAX_CENTS;
  protected readonly depositMin = DEPOSIT_MIN_CENTS;
  protected readonly depositMax = DEPOSIT_MAX_CENTS;

  protected readonly wide = toSignal(
    inject(BreakpointObserver)
      .observe(WIDE)
      .pipe(map((s) => s.matches)),
    { initialValue: true },
  );
  protected readonly editing = computed(() => this.id() !== undefined);
  protected readonly locating = signal(false);

  private readonly titleValue = toSignal(
    this.basics.controls.title.valueChanges,
    {
      initialValue: '',
    },
  );
  private readonly descriptionValue = toSignal(
    this.basics.controls.description.valueChanges,
    { initialValue: '' },
  );
  protected readonly titleLength = computed(() =>
    charLength(this.titleValue().trim()),
  );
  protected readonly descriptionLength = computed(() =>
    charLength(this.descriptionValue().trim()),
  );
  private readonly pricingDirty = signal(false);
  protected readonly pricingSaved = computed(() => !this.pricingDirty());

  /** The exact pin being placed; saved on "Next". */
  protected readonly pin = signal<GeoPoint | null>(null);
  protected readonly mapCenter = computed(
    () => this.pin() ?? this.store.item()?.location ?? DEFAULT_CENTER,
  );
  /** The approximate area others see, once the current pin is saved. */
  protected readonly savedArea = computed(() => {
    const item = this.store.item();
    const pin = this.pin();
    return item?.location && pin && distanceM(item.location, pin) < 1
      ? item.approximateLocation
      : null;
  });
  protected readonly hasLocation = computed(
    () => (this.store.item()?.location ?? null) !== null,
  );
  protected readonly publishable = computed(
    () => this.hasLocation() && this.store.readyPhotos() > 0,
  );

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        if (id) void this.store.load(id);
        else this.store.startNew();
      });
    });
    // Editing: fill the forms and the pin once the item has loaded.
    let filled = false;
    effect(() => {
      const item = this.store.item();
      if (!item || filled || !this.editing()) return;
      filled = true;
      untracked(() => {
        fillForms(item, this.basics, this.pricing);
        this.pricingDirty.set(false);
        this.pin.set(item.location ?? null);
      });
    });
    this.pricing.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.pricingDirty.set(true));
  }

  /** For the route guard: anything typed or placed but not saved yet? */
  hasUnsavedChanges(): boolean {
    const item = this.store.item();
    const pinMoved =
      this.pin() !== null &&
      (!item?.location ||
        distanceM(item.location, this.pin() as GeoPoint) >= 1);
    const uploading = this.store.uploads().some((u) => u.state !== 'failed');
    const detailsChanged = item
      ? updateBody(item, this.basics, this.pricing) !== null
      : this.basics.dirty || this.pricing.dirty;
    return detailsChanged || pinMoved || uploading;
  }

  protected async savePrice(): Promise<void> {
    this.pricing.markAllAsTouched();
    if (!pricingIsValid(this.pricing) || this.basics.invalid) return;
    const ok = await this.store.saveDetails(
      () => createBody(this.store.itemId(), this.basics, this.pricing),
      (item) => updateBody(item, this.basics, this.pricing),
    );
    if (!ok) return;
    this.basics.markAsPristine();
    this.pricing.markAsPristine();
    this.pricingDirty.set(false);
    this.advance();
  }

  protected async saveLocation(): Promise<void> {
    const pin = this.pin();
    if (!pin) return;
    const item = this.store.item();
    const unchanged = item?.location && distanceM(item.location, pin) < 1;
    if (!unchanged && !(await this.store.saveLocation(pin))) return;
    this.advance();
  }

  /**
   * On to the next step after a save. The step's [completed] binding only
   * catches up on the next render, so mark it now or the linear stepper
   * refuses to move.
   */
  private advance(): void {
    const stepper = this.stepper();
    if (!stepper?.selected) return;
    stepper.selected.completed = true;
    stepper.next();
  }

  protected async useMyLocation(): Promise<void> {
    this.locating.set(true);
    try {
      this.pin.set(await this.geolocation.currentPosition({ precise: true }));
    } catch (err) {
      const code = err instanceof GeolocationError ? err.code : 'unavailable';
      this.snackBar.open(
        this.transloco.translate(`geo.errors.${code}`),
        undefined,
        {
          duration: 6000,
        },
      );
    } finally {
      this.locating.set(false);
    }
  }

  protected async publish(): Promise<void> {
    if (await this.store.publish()) {
      this.snackBar.open(
        this.transloco.translate('listing.published'),
        undefined,
        {
          duration: 4000,
        },
      );
      void this.router.navigateByUrl('/my-items');
    }
  }

  protected finish(): void {
    void this.router.navigateByUrl('/my-items');
  }
}
