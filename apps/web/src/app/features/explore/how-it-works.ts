import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { NavIcon } from '../../core/layout/nav-icon';

export const HOW_STEPS = ['find', 'pay', 'handoff'] as const;
/** Each step shows this long before the next. */
export const STEP_EVERY_MS = 4000;

/**
 * How BorrowBox works, one step at a time: a small animated drawing with a
 * short description below, moving on by itself. It waits while pointed at
 * or focused, has a pause button (WCAG 2.2.2) and dots to pick a step, and
 * neither animates nor moves by itself for reduced motion.
 */
@Component({
  selector: 'bb-how-it-works',
  imports: [TranslocoDirective, NavIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      *transloco="let t"
      [attr.aria-label]="t('explore.how.title')"
      (mouseenter)="hovering = true"
      (mouseleave)="hovering = false"
      (focusin)="focused = true"
      (focusout)="focused = false"
    >
      <h2>{{ t('explore.how.title') }}</h2>

      <div class="stage" aria-hidden="true">
        @switch (step()) {
          @case ('find') {
            <svg class="art find" viewBox="0 0 200 120">
              <path class="street" d="M0 40h200M0 86h200M58 0v120M140 0v120" />
              <circle class="radius" cx="100" cy="62" r="20" />
              <circle class="item i1" cx="72" cy="44" r="5" />
              <circle class="item i2" cx="128" cy="78" r="5" />
              <circle class="item i3" cx="122" cy="40" r="5" />
              <path
                class="pin"
                d="M100 72c-9-11-13-17-13-23a13 13 0 0 1 26 0c0 6-4 12-13 23Z"
              />
              <circle class="pin-dot" cx="100" cy="49" r="4.5" />
            </svg>
          }
          @case ('pay') {
            <svg class="art pay" viewBox="0 0 200 120">
              <rect class="card" x="38" y="30" width="96" height="62" />
              <path class="stripe" d="M38 46h96" />
              <path class="chip" d="M50 62h16v12H50z" />
              <path
                class="shield"
                d="M146 34l22 8v18c0 15-10 24-22 30-12-6-22-15-22-30V42l22-8Z"
              />
              <path class="check" d="m135 62 8 8 15-16" />
            </svg>
          }
          @case ('handoff') {
            <svg class="art handoff" viewBox="0 0 200 120">
              <rect class="phone" x="70" y="8" width="60" height="104" rx="8" />
              <g class="qr">
                <path d="M82 34h14v14H82zM104 34h14v14h-14zM82 56h14v14H82z" />
                <path
                  class="bits"
                  d="M104 56h5v5h-5zM113 56h5v5h-5zM108 61h5v5h-5zM104 66h5v4h-5zM113 65h5v5h-5z"
                />
              </g>
              <path class="scan" d="M76 52h48" />
              <path
                class="hand-off"
                d="M30 94h26m-8-7 8 7-8 7M170 94h-26m8-7-8 7 8 7"
              />
            </svg>
          }
        }
      </div>

      <div class="caption" aria-live="polite">
        <strong
          ><span class="number">{{ index() + 1 }}</span>
          {{ t('explore.how.' + step() + '.title') }}</strong
        >
        <p>{{ t('explore.how.' + step() + '.text') }}</p>
      </div>

      <div class="controls">
        @for (s of steps; track s; let i = $index) {
          <button
            type="button"
            class="dot"
            [class.current]="i === index()"
            [attr.aria-current]="i === index() ? 'step' : null"
            [attr.aria-label]="t('explore.how.show', { n: i + 1 })"
            (click)="pick(i)"
          ></button>
        }
        @if (!reducedMotion()) {
          <button
            type="button"
            class="pause"
            [attr.aria-label]="
              t(paused() ? 'explore.how.play' : 'explore.how.pause')
            "
            (click)="paused.set(!paused())"
          >
            <bb-nav-icon [name]="paused() ? 'play' : 'pause'" />
          </button>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    h2 {
      font: var(--mat-sys-title-medium);
      font-size: 18px;
      margin: 0 0 12px;
    }
    .stage {
      aspect-ratio: 5 / 3;
      background: #fff;
      border: 1px solid rgb(16 58 99 / 0.08);
      overflow: hidden;
    }
    .art {
      animation: bb-how-in 450ms var(--bb-ease) both;
      display: block;
      height: 100%;
      width: 100%;
    }
    .caption {
      margin-top: 12px;
      min-height: 84px;
    }
    .caption strong {
      align-items: center;
      display: flex;
      font: var(--mat-sys-title-small);
      font-size: 15px;
      gap: 8px;
    }
    .number {
      align-items: center;
      background: var(--bb-sky-100);
      color: var(--bb-sky-700);
      display: inline-flex;
      font-weight: 700;
      height: 24px;
      justify-content: center;
      width: 24px;
    }
    .caption p {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      margin: 6px 0 0;
    }
    .controls {
      align-items: center;
      display: flex;
      gap: 6px;
    }
    .dot {
      background: rgb(16 58 99 / 0.18);
      border: 0;
      border-radius: 50%;
      cursor: pointer;
      height: 10px;
      padding: 0;
      transition:
        background-color var(--bb-fast) var(--bb-ease),
        width var(--bb-medium) var(--bb-ease);
      width: 10px;
    }
    .dot.current {
      background: var(--bb-sky-700);
      border-radius: 5px;
      width: 24px;
    }
    .pause {
      align-items: center;
      background: none;
      border: 0;
      border-radius: var(--bb-button-radius);
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
      display: inline-flex;
      height: 28px;
      justify-content: center;
      margin-left: auto;
      padding: 0;
      width: 28px;
    }
    .pause:hover {
      background: var(--bb-sky-100);
    }
    .pause bb-nav-icon {
      height: 16px;
      width: 16px;
    }
    .dot:focus-visible,
    .pause:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }

    /* The drawings: thin strokes in the brand's blues. Set on the drawing
       and inherited, so each shape's own fill below still wins. */
    .art {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .street {
      stroke: var(--bb-sky-100);
      stroke-width: 10;
    }
    .radius {
      fill: rgb(31 111 178 / 0.12);
      stroke: var(--bb-sky-500);
      stroke-width: 1.5;
      transform-box: fill-box;
      transform-origin: center;
      animation: bb-how-pulse 2s var(--bb-ease) infinite;
    }
    .item {
      fill: var(--bb-sky-500);
      opacity: 0;
      animation: bb-how-pop 400ms var(--bb-ease) forwards;
    }
    .i1 {
      animation-delay: 500ms;
    }
    .i2 {
      animation-delay: 900ms;
    }
    .i3 {
      animation-delay: 1300ms;
    }
    .pin {
      fill: var(--bb-sky-700);
      animation: bb-how-drop 600ms var(--bb-ease) both;
    }
    .pin-dot {
      fill: #fff;
      animation: bb-how-drop 600ms var(--bb-ease) both;
    }
    .card {
      fill: var(--bb-sky-100);
      stroke: var(--bb-sky-700);
      stroke-width: 2;
    }
    .stripe {
      stroke: var(--bb-sky-700);
      stroke-width: 7;
    }
    .chip {
      fill: var(--bb-sky-300);
    }
    .shield {
      fill: #fff;
      stroke: var(--bb-sky-700);
      stroke-width: 2.5;
      animation: bb-how-pop 500ms 200ms var(--bb-ease) both;
      transform-box: fill-box;
      transform-origin: center;
    }
    .check {
      stroke: #15803d;
      stroke-dasharray: 40;
      stroke-dashoffset: 40;
      stroke-width: 4;
      animation: bb-how-draw 600ms 700ms var(--bb-ease) forwards;
    }
    .phone {
      fill: #fff;
      stroke: var(--bb-sky-700);
      stroke-width: 2.5;
    }
    .qr path {
      fill: var(--bb-sky-700);
    }
    .scan {
      stroke: #15803d;
      stroke-width: 2.5;
      animation: bb-how-scan 1.6s ease-in-out infinite alternate;
    }
    .hand-off {
      stroke: var(--bb-sky-500);
      stroke-width: 2.5;
    }

    @keyframes bb-how-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
    @keyframes bb-how-pulse {
      0% {
        opacity: 1;
        transform: scale(0.6);
      }
      100% {
        opacity: 0;
        transform: scale(2.2);
      }
    }
    @keyframes bb-how-pop {
      from {
        opacity: 0;
        transform: scale(0.4);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
    @keyframes bb-how-drop {
      from {
        opacity: 0;
        transform: translateY(-14px);
      }
    }
    @keyframes bb-how-draw {
      to {
        stroke-dashoffset: 0;
      }
    }
    @keyframes bb-how-scan {
      from {
        transform: translateY(-14px);
      }
      to {
        transform: translateY(22px);
      }
    }
    /* Reduced motion: the finished drawing, without movement. */
    @media (prefers-reduced-motion: reduce) {
      .art,
      .art * {
        animation: none !important;
      }
      .item {
        opacity: 1;
      }
      .check {
        stroke-dashoffset: 0;
      }
      .radius {
        transform: scale(1.6);
      }
    }
  `,
})
export class HowItWorks {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly steps = HOW_STEPS;
  protected readonly index = signal(0);
  protected readonly step = computed(() => HOW_STEPS[this.index()]);
  protected readonly paused = signal(false);
  protected readonly reducedMotion = signal(
    this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches ?? false,
  );

  protected hovering = false;
  protected focused = false;

  constructor() {
    afterNextRender(() => {
      const win = this.document.defaultView;
      const timer = win?.setInterval(() => this.advance(), STEP_EVERY_MS);
      this.destroyRef.onDestroy(() => win?.clearInterval(timer));
    });
  }

  /** The timer's tick: the next step, unless something says to wait. */
  advance(): void {
    if (
      this.paused() ||
      this.reducedMotion() ||
      this.hovering ||
      this.focused ||
      this.document.hidden
    ) {
      return;
    }
    this.index.set((this.index() + 1) % HOW_STEPS.length);
  }

  protected pick(i: number): void {
    this.index.set(i);
  }
}
