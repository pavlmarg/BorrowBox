import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import type { BookingViewResponse, HandoffAnswer } from '../../api/models';
import { AthensTimePipe } from '../bookings/athens.pipes';
import { handoffActions } from './handoff-rules';
import { enterFullscreen } from './screen-awake';

/**
 * The booking page's handoff part (ADR-0026): the button to the handoff
 * screen while a pickup or return is open, "did it happen?" when nobody
 * scanned, and a neutral note while an admin looks into it.
 */
@Component({
  selector: 'bb-handoff-card',
  imports: [RouterLink, TranslocoDirective, MatButtonModule, AthensTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="card" *transloco="let t">
        <h2>{{ t('handoff.card.title') }}</h2>

        @if (booking().handoff.review; as review) {
          <p class="review" role="status">
            {{ t('handoff.review.' + review) }}
          </p>
        }

        @for (a of actions(); track a.phase) {
          <div class="action">
            <p>{{ t('handoff.card.' + a.phase + '.' + a.part) }}</p>
            @if (a.phase === 'RETURN' && beforeEnd()) {
              <p class="hint">{{ t('handoff.card.early') }}</p>
            }
            @if (a.opensAt) {
              <p class="hint">
                {{ t('handoff.opensAt', { time: (a.opensAt | athensTime) }) }}
              </p>
            } @else {
              <a
                mat-flat-button
                class="go"
                [routerLink]="['/bookings', booking().id, 'handoff']"
                [queryParams]="{ phase: a.phase }"
                (click)="fullscreen()"
                >{{ t('handoff.card.button.' + a.phase + '.' + a.part) }}</a
              >
            }
          </div>
        }

        @if (booking().handoff.question; as q) {
          <div class="question">
            <h3>{{ t('handoff.question.title.' + q.phase) }}</h3>
            @if (q.myAnswer === null) {
              <p>
                {{
                  t('handoff.question.explain.' + q.phase, {
                    time: (q.decideAt | athensTime),
                  })
                }}
              </p>
              <div class="buttons">
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="busy()"
                  (click)="answer.emit('YES')"
                >
                  {{ t('handoff.question.yes.' + q.phase) }}
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="answer.emit('NO')"
                >
                  {{ t('handoff.question.no.' + q.phase) }}
                </button>
              </div>
            } @else {
              <p>
                {{ t('handoff.question.answered.' + q.myAnswer) }}
                {{
                  t(
                    q.otherAnswered
                      ? 'handoff.question.otherAnswered'
                      : 'handoff.question.otherWaiting'
                  )
                }}
              </p>
              <p class="hint">
                {{
                  t('handoff.question.decideAt', {
                    time: (q.decideAt | athensTime),
                  })
                }}
              </p>
            }
          </div>
        }
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
      margin: 0 0 12px;
    }
    h3 {
      font: var(--mat-sys-title-small);
      font-weight: 700;
      margin: 0 0 8px;
    }
    p {
      font: var(--mat-sys-body-large);
      margin: 0 0 8px;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .review {
      background: var(--mat-sys-surface-container);
      border-left: 4px solid var(--bb-warning);
      padding: 12px 16px;
    }
    .action + .action,
    .question {
      margin-top: 20px;
    }
    .go {
      min-height: 48px;
      padding-inline: 24px;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
  `,
})
export class HandoffCard {
  readonly booking = input.required<BookingViewResponse>();
  /** The page's clock, so a pickup opening shows its button. */
  readonly now = input.required<number>();
  /** An answer is being saved. */
  readonly busy = input(false);
  /** "Did it happen?" — the page confirms, then saves. */
  readonly answer = output<HandoffAnswer>();

  protected readonly actions = computed(() =>
    handoffActions(this.booking(), new Date(this.now())),
  );
  /** The item can come back before the end (ADR-0026), so the card says so. */
  protected readonly beforeEnd = computed(
    () => this.now() < Date.parse(this.booking().end),
  );
  protected readonly visible = computed(
    () =>
      this.actions().length > 0 ||
      this.booking().handoff.question !== null ||
      this.booking().handoff.review !== null,
  );

  /** Asked on the tap itself (browsers need one); iPhones ignore it. */
  protected fullscreen(): void {
    enterFullscreen();
  }
}
