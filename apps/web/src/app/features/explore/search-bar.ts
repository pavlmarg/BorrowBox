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
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  from,
  map,
  of,
  switchMap,
} from 'rxjs';
import { Api } from '../../api/api';
import {
  peopleControllerSuggest,
  publicItemsControllerSuggest,
} from '../../api/functions';
import type {
  ItemSuggestionResponse,
  PersonSuggestionResponse,
} from '../../api/models';
import { NavIcon } from '../../core/layout/nav-icon';
import { Avatar } from '../../shared/avatar/avatar';
import { ExploreStore } from './explore.store';

/** Search as you type waits for this pause before asking. */
const SUGGEST_DEBOUNCE_MS = 250;

/** A picked suggestion: an item, or a person (ADR-0025). */
type Suggestion =
  | { kind: 'item'; item: ItemSuggestionResponse }
  | { kind: 'person'; person: PersonSuggestionResponse };
type QueryValue = string | Suggestion;

interface Suggestions {
  items: ItemSuggestionResponse[];
  people: PersonSuggestionResponse[];
}
const NONE: Suggestions = { items: [], people: [] };

/**
 * The search box. Enter searches items; while typing, up to 5 nearby items
 * whose words start with what's typed are suggested (E13), and apart from
 * them up to 5 people whose names do (ADR-0025). Picking one opens the item
 * or the person's profile. People never appear in the results themselves.
 * What's typed is never stored or logged (ADR-0007).
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
    Avatar,
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
        @if (suggestions().items.length > 0) {
          <mat-optgroup [label]="t('explore.suggest.items')">
            @for (s of suggestions().items; track s.id) {
              <mat-option [value]="{ kind: 'item', item: s }">
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
          </mat-optgroup>
        }
        @if (suggestions().people.length > 0) {
          <mat-optgroup [label]="t('explore.suggest.people')">
            @for (p of suggestions().people; track p.id) {
              <mat-option [value]="{ kind: 'person', person: p }">
                <span class="suggestion">
                  <bb-avatar [size]="40" [photoUrl]="p.photoUrl" />
                  <span class="title">{{ p.displayName }}</span>
                  <span class="band">{{
                    t('explore.suggest.itemCount', { count: p.itemCount })
                  }}</span>
                </span>
              </mat-option>
            }
          </mat-optgroup>
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
    this.query.valueChanges.pipe(map((v) => this.display(v))),
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
          ? of(NONE)
          : combineLatest({
              items: from(
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
              people: from(
                this.api.invoke(peopleControllerSuggest, { body: { q } }),
              ).pipe(
                map((r) => r.people),
                catchError(() => of([])),
              ),
            }),
      ),
    ),
    { initialValue: NONE },
  );

  protected readonly display = (v: QueryValue | null): string =>
    typeof v === 'string'
      ? v
      : v?.kind === 'person'
        ? v.person.displayName
        : (v?.item.title ?? '');

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
    const picked = event.option.value as Suggestion;
    void this.router.navigate(
      picked.kind === 'person'
        ? ['/users', picked.person.id]
        : ['/items', picked.item.id],
    );
  }
}
