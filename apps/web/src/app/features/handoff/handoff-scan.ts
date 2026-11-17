import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoDirective } from '@jsverse/transloco';
import { Api } from '../../api/api';
import { bookingsControllerHandoff } from '../../api/functions';
import type {
  BookingViewResponse,
  HandoffPhase,
  HandoffScanBody,
} from '../../api/models';
import {
  bookingErrorCode,
  type AnyBookingError,
} from '../bookings/booking-text';
import {
  cleanCode,
  isFullCode,
  scanErrorIsFinal,
  scanErrorKey,
} from './handoff-screen';

/** How often the native detector looks at the camera picture. */
const DETECT_EVERY_MS = 250;
/** After a refused scan, wait before trying (another) code. */
const PAUSE_AFTER_REFUSAL_MS = 2_500;
/** Our tokens start like this; other QR codes are ignored silently. */
const TOKEN_PREFIX = 'v1.';

type CameraProblem = 'denied' | 'unavailable';

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
type DetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

/**
 * Confirms a handoff by scanning the other person's QR code with the back
 * camera, or by typing the 6-digit code under it (no camera, refused, or
 * not working). Sends each code once, by itself; tells the page when the
 * server recorded the handoff.
 */
@Component({
  selector: 'bb-handoff-scan',
  imports: [TranslocoDirective, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scan" *transloco="let t">
      @if (mode() === 'camera') {
        <div class="viewer">
          <video #video muted playsinline></video>
          <span class="frame" aria-hidden="true"></span>
        </div>
        <p class="tell">{{ t('handoff.scan.point') }}</p>
        <button mat-button type="button" class="switch" (click)="useCode()">
          {{ t('handoff.scan.typeInstead') }}
        </button>
      } @else {
        @if (cameraProblem(); as why) {
          <p class="note">{{ t('handoff.scan.camera.' + why) }}</p>
        }
        <label class="label" for="handoff-code">{{
          t('handoff.scan.codeLabel')
        }}</label>
        <input
          #codeInput
          id="handoff-code"
          class="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="7"
          [value]="code()"
          [disabled]="sending()"
          (input)="typed($any($event.target).value)"
        />
        <p class="tell">{{ t('handoff.scan.codeHelp') }}</p>
        @if (!cameraProblem()) {
          <button mat-button type="button" class="switch" (click)="useCamera()">
            {{ t('handoff.scan.useCamera') }}
          </button>
        }
      }
      <div aria-live="assertive">
        @if (sending()) {
          <p class="sending">{{ t('handoff.scan.sending') }}</p>
        } @else if (problem(); as p) {
          <p class="problem" role="alert">
            {{ t(errorKey(p.code, p.method)) }}
          </p>
        }
      </div>
    </div>
  `,
  styles: `
    .scan {
      align-items: center;
      display: flex;
      flex-direction: column;
      gap: 12px;
      text-align: center;
    }
    .viewer {
      aspect-ratio: 1;
      background: var(--bb-camera-bg);
      overflow: hidden;
      position: relative;
      width: min(88vw, 60vh, 460px);
    }
    video {
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .frame {
      border: 3px solid var(--bb-handoff-paper);
      border-radius: 12px;
      box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.35);
      inset: 14%;
      position: absolute;
    }
    .tell,
    .note {
      font: var(--mat-sys-body-large);
      margin: 0;
      max-width: 34ch;
    }
    .note {
      color: var(--mat-sys-on-surface-variant);
    }
    .label {
      font: var(--mat-sys-title-medium);
      font-weight: 700;
    }
    .code {
      background: var(--mat-sys-surface-container);
      border: 2px solid var(--mat-sys-outline);
      border-radius: var(--bb-control-radius, 6px);
      color: var(--mat-sys-on-surface);
      font-size: 2.5rem;
      font-variant-numeric: tabular-nums;
      font-weight: 800;
      letter-spacing: 0.3em;
      padding: 8px 12px 8px calc(12px + 0.3em);
      text-align: center;
      width: 8.5ch;
    }
    .code:focus {
      border-color: var(--mat-sys-primary);
      outline: none;
    }
    .sending {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }
    .problem {
      color: var(--bb-danger);
      font-weight: 600;
      margin: 0;
      max-width: 34ch;
    }
  `,
})
export class HandoffScan {
  readonly bookingId = input.required<string>();
  readonly phase = input.required<HandoffPhase>();
  /** The booking once the server recorded the handoff. */
  readonly scanned = output<BookingViewResponse>();

  private readonly api = inject(Api);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly codeInput =
    viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected readonly mode = signal<'camera' | 'code'>('camera');
  protected readonly cameraProblem = signal<CameraProblem | null>(null);
  protected readonly code = signal('');
  protected readonly sending = signal(false);
  protected readonly problem = signal<{
    code: AnyBookingError;
    method: 'QR' | 'CODE';
  } | null>(null);
  protected readonly errorKey = scanErrorKey;

  private stream: MediaStream | null = null;
  private stopDetecting: (() => void) | null = null;
  /** No scans until then (after a refusal), and never the same one twice. */
  private pausedUntil = 0;
  private lastToken = '';
  private finished = false;

  constructor() {
    afterNextRender(() => void this.startCamera());
    inject(DestroyRef).onDestroy(() => {
      this.finished = true;
      this.stopCamera();
    });
  }

  protected useCode(): void {
    this.stopCamera();
    this.mode.set('code');
    setTimeout(() => this.codeInput()?.nativeElement.focus());
  }

  protected useCamera(): void {
    this.problem.set(null);
    this.mode.set('camera');
    // The <video> exists after this change is rendered.
    setTimeout(() => void this.startCamera());
  }

  protected typed(value: string): void {
    const code = cleanCode(value);
    this.code.set(code);
    // Keep the field showing exactly what counts.
    const field = this.codeInput()?.nativeElement;
    if (field && field.value !== code) field.value = code;
    if (isFullCode(code)) {
      void this.send({ phase: this.phase(), code }, 'CODE');
    }
  }

  private async startCamera(): Promise<void> {
    if (this.finished || this.mode() !== 'camera') return;
    const video = this.video()?.nativeElement;
    if (!video) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraFailed('unavailable');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (this.finished || this.mode() !== 'camera') {
        this.stopCamera();
        return;
      }
      video.srcObject = this.stream;
      await video.play();
      this.stopDetecting = await this.detect(video, this.stream);
    } catch (err) {
      const denied =
        err instanceof DOMException && err.name === 'NotAllowedError';
      this.cameraFailed(denied ? 'denied' : 'unavailable');
    }
  }

  /** Native detector where there is one (Android), zxing otherwise (iOS). */
  private async detect(
    video: HTMLVideoElement,
    stream: MediaStream,
  ): Promise<() => void> {
    const Native = (globalThis as { BarcodeDetector?: DetectorClass })
      .BarcodeDetector;
    if (Native && (await Native.getSupportedFormats()).includes('qr_code')) {
      const detector = new Native({ formats: ['qr_code'] });
      let busy = false;
      const timer = setInterval(async () => {
        if (busy || video.readyState < 2) return;
        busy = true;
        try {
          const found = await detector.detect(video);
          if (found[0]) this.seen(found[0].rawValue);
        } catch {
          // A frame it couldn't read: try the next.
        } finally {
          busy = false;
        }
      }, DETECT_EVERY_MS);
      return () => clearInterval(timer);
    }
    const { BrowserQRCodeReader } = await import('@zxing/browser');
    const controls = await new BrowserQRCodeReader().decodeFromStream(
      stream,
      video,
      (result) => {
        if (result) this.seen(result.getText());
      },
    );
    return () => controls.stop();
  }

  private seen(text: string): void {
    if (!text.startsWith(TOKEN_PREFIX) || this.sending()) return;
    if (Date.now() < this.pausedUntil || text === this.lastToken) return;
    this.lastToken = text;
    void this.send({ token: text }, 'QR');
  }

  private async send(
    body: HandoffScanBody,
    method: 'QR' | 'CODE',
  ): Promise<void> {
    if (this.sending() || this.finished) return;
    this.sending.set(true);
    this.problem.set(null);
    try {
      const booking = await this.api.invoke(bookingsControllerHandoff, {
        bookingId: this.bookingId(),
        body,
      });
      this.finished = true;
      this.stopCamera();
      this.scanned.emit(booking);
    } catch (err) {
      const code = bookingErrorCode(err);
      this.problem.set({ code, method });
      this.pausedUntil = Date.now() + PAUSE_AFTER_REFUSAL_MS;
      // A code the server judged stays refused; after anything else (no
      // network, Redis down) the same QR may be tried again after the pause.
      if (code !== 'TOKEN_INVALID' && code !== 'TOKEN_EXPIRED') {
        this.lastToken = '';
      }
      if (scanErrorIsFinal(code)) this.stopCamera();
      if (method === 'CODE') {
        this.code.set('');
        setTimeout(() => this.codeInput()?.nativeElement.focus());
      }
    } finally {
      this.sending.set(false);
    }
  }

  private cameraFailed(why: CameraProblem): void {
    this.stopCamera();
    this.cameraProblem.set(why);
    this.mode.set('code');
    setTimeout(() => this.codeInput()?.nativeElement.focus());
  }

  private stopCamera(): void {
    this.stopDetecting?.();
    this.stopDetecting = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
