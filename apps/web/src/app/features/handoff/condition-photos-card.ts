import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoDirective } from '@jsverse/transloco';
import { CONDITION_PHOTOS_MAX_PER_PHASE } from '@borrowbox/contracts';
import type {
  BookingViewResponse,
  ConditionPhotoResponse,
  HandoffPhase,
} from '../../api/models';
import { AthensTimePipe } from '../bookings/athens.pipes';
import { bookingErrorKey } from '../bookings/booking-text';
import {
  ConditionPhotosStore,
  type ConditionPhotoProblem,
} from './condition-photos.store';

const PHASES: readonly HandoffPhase[] = ['PICKUP', 'RETURN'];
const FILE_PROBLEMS = ['unsupported', 'tooSmall', 'tooLarge', 'unreadable'];
/** Links last 5 minutes; look this often whether they need renewing. */
const LINK_CHECK_MS = 60_000;

/** The message for a photo that couldn't be added. */
export function photoProblemKey(problem: ConditionPhotoProblem): string {
  if (FILE_PROBLEMS.includes(problem)) return `listing.photoErrors.${problem}`;
  if (problem === 'REJECTED') return 'handoff.photos.rejected';
  if (problem === 'PHOTO_LIMIT_REACHED') return 'handoff.photos.limit';
  if (problem === 'INVALID_STATE') return 'handoff.photos.closed';
  return bookingErrorKey(problem as Parameters<typeof bookingErrorKey>[0]);
}

/**
 * The booking's condition photos (ADR-0027), per handoff: both people's,
 * with who took them and when (the server's time). Each adds up to 3 while
 * their window is open, from the camera or the gallery, and may remove
 * their own until it closes. Only the two of them can see these.
 */
@Component({
  selector: 'bb-condition-photos-card',
  imports: [TranslocoDirective, MatButtonModule, AthensTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="card" *transloco="let t">
        <h2>{{ t('handoff.photos.title') }}</h2>
        <p class="hint">{{ t('handoff.photos.explain') }}</p>

        @for (phase of phasesShown(); track phase) {
          <h3>{{ t('handoff.photos.phase.' + phase) }}</h3>
          @if (inPhase(phase).length === 0) {
            <p class="hint">{{ t('handoff.photos.none') }}</p>
          }
          <ul class="grid">
            @for (p of inPhase(phase); track p.id) {
              <li class="photo">
                @switch (p.status) {
                  @case ('READY') {
                    @if (p.urls; as urls) {
                      <a
                        class="thumb"
                        [href]="urls.large"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          [src]="urls.thumb"
                          [alt]="t('handoff.photos.alt.' + phase)"
                          loading="lazy"
                        />
                      </a>
                    }
                  }
                  @case ('FAILED') {
                    <span class="thumb placeholder">{{
                      t('handoff.photos.failed')
                    }}</span>
                  }
                  @default {
                    <span class="thumb placeholder">{{
                      t('handoff.photos.processing')
                    }}</span>
                  }
                }
                <span class="caption">
                  {{
                    p.mine
                      ? t('handoff.photos.byYou')
                      : t('handoff.photos.by.' + p.takenBy)
                  }}
                  @if (p.takenAt) {
                    · {{ p.takenAt | athensTime }}
                  }
                </span>
                @if (p.mine && store.canAdd()[phase]) {
                  <button
                    mat-button
                    type="button"
                    class="remove"
                    [disabled]="store.removing() !== null"
                    (click)="store.remove(booking().id, p.id)"
                  >
                    {{ t('handoff.photos.remove') }}
                  </button>
                }
              </li>
            }
          </ul>
          @if (canAddIn(phase)) {
            <input
              #picker
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              (change)="picked(phase, picker)"
            />
            <button
              mat-stroked-button
              type="button"
              class="add"
              [disabled]="store.adding() !== null"
              (click)="picker.click()"
            >
              {{
                store.adding() === phase
                  ? t('handoff.photos.adding')
                  : t('handoff.photos.add', { left: leftIn(phase) })
              }}
            </button>
          }
        }

        <div aria-live="assertive">
          @if (store.problem(); as problem) {
            <p class="problem" role="alert">{{ t(problemKey(problem)) }}</p>
          }
        </div>
      </section>
    }
  `,
  styles: `
    .card {
      border-top: 1px solid var(--mat-sys-outline-variant);
      margin-top: 24px;
      padding-top: 20px;
    }
    h2 {
      font: var(--mat-sys-title-medium);
      font-weight: 700;
      margin: 0 0 4px;
    }
    h3 {
      font: var(--mat-sys-title-small);
      font-weight: 700;
      margin: 20px 0 8px;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 0 0 8px;
    }
    .grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
    .photo {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .thumb {
      aspect-ratio: 1;
      background: var(--mat-sys-surface-container);
      border-radius: var(--bb-radius);
      display: block;
      overflow: hidden;
    }
    .thumb img {
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .placeholder {
      align-content: center;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      padding: 8px;
      text-align: center;
    }
    .caption {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .remove {
      align-self: flex-start;
    }
    .problem {
      color: var(--mat-sys-error);
      margin: 8px 0 0;
    }
  `,
})
export class ConditionPhotosCard {
  readonly booking = input.required<BookingViewResponse>();

  protected readonly store = inject(ConditionPhotosStore);
  protected readonly problemKey = photoProblemKey;

  protected readonly phasesShown = computed(() =>
    PHASES.filter(
      (phase) =>
        this.store.canAdd()[phase] ||
        this.store.photos().some((p) => p.phase === phase),
    ),
  );
  protected readonly visible = computed(() => this.phasesShown().length > 0);

  constructor() {
    const timer = setInterval(
      () => void this.store.refreshLinks(this.booking().id),
      LINK_CHECK_MS,
    );
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected inPhase(phase: HandoffPhase): ConditionPhotoResponse[] {
    return this.store.photos().filter((p) => p.phase === phase);
  }

  protected leftIn(phase: HandoffPhase): number {
    const mine = this.inPhase(phase).filter((p) => p.mine).length;
    return Math.max(0, CONDITION_PHOTOS_MAX_PER_PHASE - mine);
  }

  protected canAddIn(phase: HandoffPhase): boolean {
    return this.store.canAdd()[phase] && this.leftIn(phase) > 0;
  }

  protected picked(phase: HandoffPhase, picker: HTMLInputElement): void {
    const file = picker.files?.[0];
    // The same photo can be picked again after a failure.
    picker.value = '';
    if (file) void this.store.add(this.booking().id, phase, file);
  }
}
