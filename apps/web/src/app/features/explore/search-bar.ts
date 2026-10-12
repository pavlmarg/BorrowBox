import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  type MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SUGGEST_MIN_LENGTH,
} from '@borrowbox/contracts';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  from,
  map,
  of,
  switchMap,
} from 'rxjs';
import { Api } from '../../api/api';
import { publicItemsControllerSuggest } from '../../api/functions';
import type { ItemSuggestionResponse } from '../../api/models';
import { NavIcon } from '../../core/layout/nav-icon';
import { ExploreStore } from './explore.store';

/** Search as you type waits for this pause before asking. */
const SUGGEST_DEBOUNCE_MS = 250;

type QueryValue = string | ItemSuggestionResponse;

/**
 * The search box. Enter searches; while typing, up to 5 nearby items whose
 * words start with what's typed are suggested, and picking one opens it
 * (E13). What's typed is never stored or logged (ADR-0007).
 */
@Component({
  selector: 'bb-search-bar',
  imports: [
    ReactiveFormsModule,
    TranslocoDirective,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    NavIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form role="search" *transloco="let t" (submit)="submit($event)">
      <mat-form-field class="field" subscriptSizing="dynamic">
        <bb-nav-icon matPrefix name="search" class="prefix" />
        <input
          matInput
          type="search"
          enterkeyhint="search"
          [maxlength]="maxLength"
          [formControl]="query"
          [matAutocomplete]="auto"
          [placeholder]="t('explore.searchPlaceholder')"
          [attr.aria-label]="t('explore.searchPlaceholder')"
        />
        @if (hasText()) {
          <button
            matSuffix
            type="button"
            class="clear"
            [attr.aria-label]="t('explore.clear')"
            (click)="clear()"
          >
            <bb-nav-icon name="close" />
          </button>
        }
      </mat-form-field>
      <mat-autocomplete
        #auto
        [displayWith]="display"
        (optionSelected)="open($event)"
      >
        @for (s of suggestions(); track s.id) {
          <mat-option [value]="s">
            <span class="suggestion">
              <span class="thumb">
                @if (s.thumbnailUrl) {
                  <img [src]="s.thumbnailUrl" alt="" />
                }
              </span>
              <span class="title">{{ s.title }}</span>
              <span class="band">{{
                t('catalog.distance.' + s.distanceBand)
              }}</span>
            </span>
          </mat-option>
        }
      </mat-autocomplete>
    </form>
  `,
  styles: `
    @use '@angular/material' as mat;

    :host {
      @include mat.form-field-density(-2);
    }
    .field {
      width: 100%;
    }
    .prefix {
      color: var(--mat-sys-on-surface-variant);
      display: inline-flex;
      height: 20px;
      margin: 0 4px 0 12px;
      width: 20px;
    }
    .clear {
      align-items: center;
      background: none;
      border: 0;
      border-radius: var(--bb-button-radius);
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
      display: inline-flex;
      height: 36px;
      justify-content: center;
      margin-right: 6px;
      width: 36px;
    }
    .clear:hover {
      background: var(--bb-sky-100);
    }
    .clear bb-nav-icon {
      height: 18px;
      width: 18px;
    }
    .suggestion {
      align-items: center;
      display: flex;
      gap: 12px;
      min-width: 0;
    }
    .thumb {
      background: var(--bb-sky-100);
      flex: none;
      height: 40px;
      overflow: hidden;
      width: 40px;
    }
    .thumb img {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .band {
      color: var(--mat-sys-on-surface-variant);
      flex: none;
      font: var(--mat-sys-body-small);
    }
  `,
})
export class SearchBar {
  private readonly store = inject(ExploreStore);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly maxLength = SEARCH_QUERY_MAX_LENGTH;
  protected readonly query = new FormControl<QueryValue>('', {
    nonNullable: true,
  });

  private readonly typed = toSignal(
    this.query.valueChanges.pipe(
      map((v) => (typeof v === 'string' ? v : v.title)),
    ),
    { initialValue: '' },
  );
  protected readonly hasText = () => this.typed().trim() !== '';

  protected readonly suggestions = toSignal(
    this.query.valueChanges.pipe(
      map((v) => (typeof v === 'string' ? v.trim() : '')),
      debounceTime(SUGGEST_DEBOUNCE_MS),
      distinctUntilChanged(),
      switchMap((q) =>
        q.length < SUGGEST_MIN_LENGTH
          ? of([])
          : from(
              this.api.invoke(publicItemsControllerSuggest, {
                body: {
                  q,
                  near: this.store.center(),
                  radiusKm: this.store.filters().radiusKm,
                },
              }),
            ).pipe(
              map((r) => r.suggestions),
              // Suggestions are a convenience: failing quietly is fine.
              catchError(() => of([])),
            ),
      ),
    ),
    { initialValue: [] as ItemSuggestionResponse[] },
  );

  protected readonly display = (v: QueryValue | null) =>
    typeof v === 'string' ? v : (v?.title ?? '');

  constructor() {
    // Show the search that's on screen (from the URL, or coming back).
    effect(() => {
      const q = this.store.filters().q;
      untracked(() => {
        if (this.display(this.query.value).trim() !== q) {
          this.query.setValue(q, { emitEvent: false });
        }
      });
    });
  }

  protected submit(event: Event): void {
    event.preventDefault();
    void this.store.setFilters({ q: this.display(this.query.value).trim() });
  }

  protected clear(): void {
    this.query.setValue('');
    void this.store.setFilters({ q: '' });
  }

  protected open(event: MatAutocompleteSelectedEvent): void {
    const suggestion = event.option.value as ItemSuggestionResponse;
    void this.router.navigate(['/items', suggestion.id]);
  }
}
