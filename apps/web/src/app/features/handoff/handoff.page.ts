import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import type { HandoffPhase } from '../../api/models';
import { AthensTimePipe } from '../bookings/athens.pipes';
import { bookingErrorKey } from '../bookings/booking-text';
import { BookingStore } from '../bookings/booking.store';
import { HandoffScan } from './handoff-scan';
import { handoffDone } from './handoff-screen';
import { HandoffShow } from './handoff-show';
import { handoffActions } from './handoff-rules';
import { leaveFullscreen } from './screen-awake';

/** While showing a code, how often to look whether it was scanned. */
const POLL_EVERY_MS = 5_000;

const PHASES: readonly HandoffPhase[] = ['PICKUP', 'RETURN'];

/**
 * The handoff screen (`/bookings/:id/handoff?phase=PICKUP|RETURN`), full
 * screen without the app's bars (ADR-0026): the person who shows gets the
 * QR code, the other one the camera (or the typed code). Ends on "done".
 */
@Component({
  selector: 'bb-handoff-page',
  imports: [
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    AthensTimePipe,
    HandoffShow,
    HandoffScan,
  ],
  providers: [BookingStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="screen"
      [class.paper]="action()?.part === 'SHOW' && !done()"
      *transloco="let t"
    >
      <header class="bar">
        <a
          mat-button
          class="close"
          [routerLink]="['/bookings', id()]"
          [attr.aria-label]="t('handoff.close')"
          >✕ {{ t('handoff.close') }}</a
        >
      </header>

      @switch (store.status()) {
        @case ('loading') {
          <p class="center muted" aria-live="polite">
            {{ t('bookings.detail.loading') }}
          </p>
        }
        @case ('error') {
          <p class="center" role="alert">
            {{ t(errorKey(store.error() ?? 'INTERNAL')) }}
          </p>
        }
        @case ('ready') {
          @if (store.booking(); as b) {
            @if (!validPhase()) {
              <p class="center">{{ t('handoff.notOpen') }}</p>
            } @else if (done()) {
              <section class="center done" aria-live="polite">
                <span class="tick" aria-hidden="true">✓</span>
                <h1>{{ t('handoff.done.' + validPhase()) }}</h1>
                <p>{{ t('handoff.done.photos') }}</p>
                <a mat-flat-button [routerLink]="['/bookings', b.id]">{{
                  t('handoff.backToBooking')
                }}</a>
              </section>
            } @else if (action(); as a) {
              <h1 class="title">
                {{ t('handoff.title.' + a.phase + '.' + a.part) }}
              </h1>
              @if (a.opensAt) {
                <p class="center">
                  {{ t('handoff.opensAt', { time: (a.opensAt | athensTime) }) }}
                </p>
              } @else if (a.part === 'SHOW') {
                <bb-handoff-show [bookingId]="b.id" [phase]="a.phase" />
              } @else {
                <bb-handoff-scan
                  [bookingId]="b.id"
                  [phase]="a.phase"
                  (scanned)="recorded()"
                />
              }
            } @else {
              <p class="center">{{ t('handoff.notOpen') }}</p>
            }
          }
        }
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
    }
    .screen {
      background: var(--mat-sys-surface);
      box-sizing: border-box;
      color: var(--mat-sys-on-surface);
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 100dvh;
      padding: 8px 16px 32px;
    }
    /* The brightest the page can be: white even in dark mode. */
    .screen.paper {
      background: var(--bb-handoff-paper);
      color: var(--bb-handoff-ink);
    }
    .screen.paper .close {
      color: var(--bb-handoff-ink);
    }
    .bar {
      display: flex;
    }
    .title {
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      margin: 0;
      text-align: center;
    }
    .center {
      align-self: center;
      font: var(--mat-sys-body-large);
      margin: 15vh 0 0;
      max-width: 36ch;
      text-align: center;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .done {
      align-items: center;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .done h1 {
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      margin: 0;
    }
    .done p {
      margin: 0;
    }
    .tick {
      background: var(--bb-success-bg);
      border-radius: 50%;
      color: var(--bb-check);
      font-size: 3rem;
      font-weight: 800;
      height: 88px;
      line-height: 88px;
      width: 88px;
    }
  `,
})
export class HandoffPage {
  /** From the route (`/bookings/:id/handoff`). */
  readonly id = input.required<string>();
  /** From the query (`?phase=`). */
  readonly phase = input<string | undefined>();

  protected readonly store = inject(BookingStore);
  protected readonly errorKey = bookingErrorKey;
  private readonly now = signal(Date.now());

  protected readonly validPhase = computed(() => {
    const phase = this.phase();
    return PHASES.includes(phase as HandoffPhase)
      ? (phase as HandoffPhase)
      : null;
  });
  protected readonly done = computed(() => {
    const b = this.store.booking();
    const phase = this.validPhase();
    return !!b && !!phase && handoffDone(b, phase);
  });
  protected readonly action = computed(() => {
    const b = this.store.booking();
    const phase = this.validPhase();
    if (!b || !phase) return null;
    return handoffActions(b, new Date(this.now())).find(
      (a) => a.phase === phase,
    );
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.load(id));
    });

    // The clock (a pickup opening) and, while showing, the scan's arrival.
    const tick = setInterval(() => {
      this.now.set(Date.now());
      if (this.action()?.part === 'SHOW' && !this.done()) {
        void this.store.load(this.id(), true);
      }
    }, POLL_EVERY_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      leaveFullscreen();
    });
  }

  /** The scan answered with the booking; fetch it so every part agrees. */
  protected recorded(): void {
    void this.store.load(this.id(), true);
  }
}
