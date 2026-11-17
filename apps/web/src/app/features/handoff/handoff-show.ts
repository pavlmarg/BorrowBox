import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Api } from '../../api/api';
import { bookingsControllerHandoffToken } from '../../api/functions';
import type { HandoffPhase, HandoffTokenResponse } from '../../api/models';
import {
  bookingErrorCode,
  type AnyBookingError,
} from '../bookings/booking-text';
import {
  groupCode,
  nextTokenDelayMs,
  scanErrorIsFinal,
  scanErrorKey,
} from './handoff-screen';
import { keepScreenAwake } from './screen-awake';

/** After this long without a scan, suggest more brightness or the code. */
const HINT_AFTER_MS = 20_000;
const RETRY_AFTER_MS = 5_000;

/**
 * The QR code and 6-digit code the other person scans (ADR-0026): black on
 * white, as big as the screen allows, renewed before each one expires. The
 * screen stays on while it's shown. The page notices the scan.
 */
@Component({
  selector: 'bb-handoff-show',
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="show" *transloco="let t">
      <div class="qr" [class.waiting]="!token()">
        <canvas #qr [attr.aria-label]="t('handoff.show.qrLabel')"></canvas>
      </div>
      @if (token(); as tk) {
        <p class="code" [attr.aria-label]="t('handoff.show.codeLabel')">
          {{ grouped(tk.code) }}
        </p>
        <div class="renew" aria-hidden="true">
          <span class="ring" [style.--left]="left()"></span>
          {{ t('handoff.show.renews', { s: secondsLeft() }) }}
        </div>
      }
      <p class="tell">{{ t('handoff.show.tell.' + phase()) }}</p>
      @if (problem(); as code) {
        <p class="problem" role="alert">{{ t(errorKey(code)) }}</p>
      } @else if (hint()) {
        <p class="hint">{{ t('handoff.show.hint') }}</p>
      }
    </div>
  `,
  styles: `
    .show {
      align-items: center;
      display: flex;
      flex-direction: column;
      gap: 12px;
      text-align: center;
    }
    .qr {
      aspect-ratio: 1;
      background: var(--bb-handoff-paper);
      width: min(84vw, 62vh, 440px);
    }
    .qr.waiting {
      opacity: 0.2;
    }
    /* qrcode sets a pixel size inline; the box decides. */
    canvas {
      display: block;
      height: 100% !important;
      width: 100% !important;
    }
    .code {
      font-size: clamp(2.25rem, 11vw, 3.5rem);
      font-variant-numeric: tabular-nums;
      font-weight: 800;
      letter-spacing: 0.08em;
      margin: 4px 0 0;
    }
    .renew {
      align-items: center;
      display: inline-flex;
      font: var(--mat-sys-body-medium);
      gap: 8px;
      opacity: 0.75;
    }
    .ring {
      background: conic-gradient(
        currentColor calc(var(--left) * 1turn),
        transparent 0
      );
      border: 2px solid currentColor;
      border-radius: 50%;
      height: 16px;
      width: 16px;
    }
    .tell {
      font: var(--mat-sys-body-large);
      margin: 8px 0 0;
      max-width: 34ch;
    }
    .hint {
      font: var(--mat-sys-body-medium);
      margin: 0;
      max-width: 34ch;
      opacity: 0.75;
    }
    .problem {
      color: var(--bb-danger);
      font-weight: 600;
      margin: 0;
      max-width: 34ch;
    }
  `,
})
export class HandoffShow {
  readonly bookingId = input.required<string>();
  readonly phase = input.required<HandoffPhase>();

  private readonly api = inject(Api);
  private readonly canvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('qr');

  protected readonly token = signal<HandoffTokenResponse | null>(null);
  protected readonly problem = signal<AnyBookingError | null>(null);
  protected readonly hint = signal(false);
  private readonly now = signal(Date.now());
  /** When the shown code is renewed, and how long it was shown for. */
  private readonly renewAt = signal(0);
  private readonly shownFor = signal(1);

  protected readonly grouped = groupCode;
  protected readonly errorKey = (code: AnyBookingError) =>
    scanErrorKey(code, 'QR');
  protected readonly secondsLeft = computed(() =>
    Math.max(0, Math.ceil((this.renewAt() - this.now()) / 1000)),
  );
  /** 1 → 0 as the next code approaches, for the ring. */
  protected readonly left = computed(() =>
    Math.min(1, Math.max(0, (this.renewAt() - this.now()) / this.shownFor())),
  );

  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor() {
    const release = keepScreenAwake();
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    const hint = setTimeout(() => this.hint.set(true), HINT_AFTER_MS);
    afterNextRender(() => void this.renew());
    inject(DestroyRef).onDestroy(() => {
      this.stopped = true;
      release();
      clearInterval(tick);
      clearTimeout(hint);
      if (this.timer) clearTimeout(this.timer);
    });
  }

  private async renew(): Promise<void> {
    if (this.stopped) return;
    try {
      const token = await this.api.invoke(bookingsControllerHandoffToken, {
        bookingId: this.bookingId(),
        phase: this.phase(),
      });
      if (this.stopped) return;
      await this.draw(token.token);
      this.token.set(token);
      this.problem.set(null);
      const now = Date.now();
      const delay = nextTokenDelayMs(token, now);
      this.now.set(now);
      this.renewAt.set(now + delay);
      this.shownFor.set(delay);
      this.schedule(delay);
    } catch (err) {
      const code = bookingErrorCode(err);
      this.problem.set(code);
      // A code that may have expired must not stay up.
      this.token.set(null);
      if (!scanErrorIsFinal(code)) this.schedule(RETRY_AFTER_MS);
    }
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.renew(), ms);
  }

  private async draw(text: string): Promise<void> {
    // Loaded on this screen only (bundle budget).
    // CommonJS: the bundle has it under `default`, Jest's mock doesn't.
    const mod = await import('qrcode');
    const qrcode = mod.default ?? mod;
    const paper = getComputedStyle(this.canvas().nativeElement);
    await qrcode.toCanvas(this.canvas().nativeElement, text, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 720,
      color: {
        dark: paper.getPropertyValue('--bb-handoff-ink').trim() || '#000',
        light: paper.getPropertyValue('--bb-handoff-paper').trim() || '#fff',
      },
    });
  }
}
