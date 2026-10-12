import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslocoDirective } from '@jsverse/transloco';
import type { PublicPhotoResponse } from '../../api/models';
import { NavIcon } from '../../core/layout/nav-icon';

export interface PhotoViewerData {
  photos: readonly PublicPhotoResponse[];
  /** The photo to start on. */
  index: number;
  title: string;
}

/** How far a photo zooms in, and what a click or tap zooms to. */
export const MAX_SCALE = 4;
export const CLICK_SCALE = 2.5;
/** A pointer that moved less than this was a click, not a drag. */
const CLICK_SLOP_PX = 5;

interface Point {
  x: number;
  y: number;
}

/**
 * An item's photos, full screen: click or tap to zoom in where you point
 * (and again to zoom out), the wheel or a pinch to zoom gradually, drag to
 * look around a zoomed photo. Arrows, ←/→ and the thumbnails move between
 * photos; Esc or ✕ closes. Opened by the gallery in a MatDialog
 * (`.bb-photo-viewer-panel` in styles.scss).
 */
@Component({
  selector: 'bb-photo-viewer',
  imports: [MatDialogModule, TranslocoDirective, NavIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKey($event)' },
  template: `
    <div class="viewer" *transloco="let t">
      <header class="top">
        <span class="counter" aria-live="polite">{{
          t('item.photoCount', { n: index() + 1, total: data.photos.length })
        }}</span>
        <span class="title">{{ data.title }}</span>
        <button
          type="button"
          class="round close"
          mat-dialog-close
          [attr.aria-label]="t('item.closePhoto')"
        >
          <bb-nav-icon name="close" />
        </button>
      </header>

      <div
        class="stage"
        #stage
        [class.zoomed]="scale() > 1"
        [class.dragging]="dragging()"
        (wheel)="onWheel($event)"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
      >
        <img
          #image
          [src]="photo().urls.large"
          [alt]="data.title"
          draggable="false"
          [style.transform]="transform()"
        />
      </div>

      @if (data.photos.length > 1) {
        <button
          type="button"
          class="round arrow prev"
          [attr.aria-label]="t('item.previousPhoto')"
          (click)="go(index() - 1)"
        >
          <bb-nav-icon name="chevron-left" />
        </button>
        <button
          type="button"
          class="round arrow next"
          [attr.aria-label]="t('item.nextPhoto')"
          (click)="go(index() + 1)"
        >
          <bb-nav-icon name="chevron-right" />
        </button>
        <div class="thumbs">
          @for (p of data.photos; track p.id; let i = $index) {
            <button
              type="button"
              class="thumb"
              [class.current]="i === index()"
              [attr.aria-current]="i === index()"
              [attr.aria-label]="
                t('item.photoCount', { n: i + 1, total: data.photos.length })
              "
              (click)="go(i)"
            >
              <img [src]="p.urls.small" alt="" />
            </button>
          }
        </div>
      }
      <p class="hint">{{ t('item.zoomHint') }}</p>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .viewer {
      background: #0b1220;
      color: #fff;
      display: grid;
      grid-template-rows: auto 1fr auto auto;
      height: 100%;
      position: relative;
    }
    .top {
      align-items: center;
      display: flex;
      gap: 16px;
      padding: 12px 16px;
    }
    .counter {
      font: var(--mat-sys-label-large);
      font-variant-numeric: tabular-nums;
      opacity: 0.85;
    }
    .title {
      flex: 1;
      font: var(--mat-sys-title-medium);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stage {
      align-items: center;
      cursor: zoom-in;
      display: flex;
      justify-content: center;
      overflow: hidden;
      position: relative;
      touch-action: none;
      user-select: none;
    }
    .stage.zoomed {
      cursor: grab;
    }
    .stage.dragging {
      cursor: grabbing;
    }
    .stage img {
      max-height: 100%;
      max-width: 100%;
      object-fit: contain;
      transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
      will-change: transform;
    }
    /* Following the fingers or the mouse: no lag. */
    .stage.dragging img {
      transition: none;
    }
    .round {
      align-items: center;
      background: rgb(255 255 255 / 0.12);
      border: 0;
      border-radius: 50%;
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      height: 44px;
      justify-content: center;
      padding: 0;
      transition: background-color var(--bb-medium) var(--bb-ease);
      width: 44px;
    }
    .round:hover {
      background: rgb(255 255 255 / 0.24);
    }
    .round:focus-visible,
    .thumb:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .arrow {
      position: absolute;
      top: calc(50% - 22px);
      z-index: 1;
    }
    .prev {
      left: 16px;
    }
    .next {
      right: 16px;
    }
    .thumbs {
      display: flex;
      gap: 8px;
      justify-content: center;
      overflow-x: auto;
      padding: 12px 16px 4px;
      scrollbar-width: none;
    }
    .thumb {
      background: none;
      border: 2px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      flex: none;
      height: 56px;
      opacity: 0.55;
      overflow: hidden;
      padding: 0;
      transition:
        opacity var(--bb-medium) var(--bb-ease),
        border-color var(--bb-medium) var(--bb-ease);
      width: 56px;
    }
    .thumb:hover {
      opacity: 0.85;
    }
    .thumb.current {
      border-color: #fff;
      opacity: 1;
    }
    .thumb img {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .hint {
      font: var(--mat-sys-body-small);
      margin: 0;
      opacity: 0.6;
      padding: 6px 16px 12px;
      text-align: center;
    }
    @media (max-width: 599px) {
      .arrow {
        display: none;
      }
    }
  `,
})
export class PhotoViewer {
  protected readonly data = inject<PhotoViewerData>(MAT_DIALOG_DATA);

  protected readonly index = signal(this.data.index);
  /** The photo on screen, for the gallery to follow after closing. */
  readonly shownIndex = this.index.asReadonly();
  protected readonly photo = computed(() => this.data.photos[this.index()]);
  /** Zoom and pan; the image's centre is the transform origin. */
  protected readonly scale = signal(1);
  private readonly pan = signal<Point>({ x: 0, y: 0 });
  protected readonly dragging = signal(false);
  protected readonly transform = computed(
    () =>
      `translate(${this.pan().x}px, ${this.pan().y}px) scale(${this.scale()})`,
  );

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly image =
    viewChild.required<ElementRef<HTMLImageElement>>('image');

  /** Pointers down on the stage, for drags and pinches. */
  private readonly pointers = new Map<number, Point>();
  private gesture: {
    startPan: Point;
    startScale: number;
    startDistance: number;
    startMid: Point;
    moved: boolean;
  } | null = null;

  /** Another photo (wrapping around), shown whole. */
  go(i: number): void {
    const n = this.data.photos.length;
    this.index.set(((i % n) + n) % n);
    this.reset();
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') this.go(this.index() - 1);
    else if (event.key === 'ArrowRight') this.go(this.index() + 1);
    else return;
    event.preventDefault();
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.zoomAt(
      this.fromCentre(event),
      this.scale() * Math.exp(-event.deltaY * 0.0015),
    );
  }

  protected onPointerDown(event: PointerEvent): void {
    this.stage().nativeElement.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, this.fromCentre(event));
    this.startGesture();
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId) || !this.gesture) return;
    this.pointers.set(event.pointerId, this.fromCentre(event));
    const g = this.gesture;
    const [a, b] = [...this.pointers.values()];
    if (b) {
      // Pinch: zoom by the change in distance, around the fingers' middle.
      g.moved = true;
      this.dragging.set(true);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = g.startScale * (distance(a, b) / g.startDistance);
      this.applyZoom(g.startMid, g.startPan, g.startScale, scale);
      // ...and follow the middle as it moves.
      this.setPan({
        x: this.pan().x + mid.x - g.startMid.x,
        y: this.pan().y + mid.y - g.startMid.y,
      });
      return;
    }
    const dx = a.x - g.startMid.x;
    const dy = a.y - g.startMid.y;
    if (!g.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    g.moved = true;
    if (this.scale() > 1) {
      this.dragging.set(true);
      this.setPan({ x: g.startPan.x + dx, y: g.startPan.y + dy });
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    const point = this.pointers.get(event.pointerId);
    const wasClick =
      this.pointers.size === 1 && this.gesture !== null && !this.gesture.moved;
    this.pointers.delete(event.pointerId);
    if (wasClick && point && event.type === 'pointerup') {
      // A click or tap: zoom in where it was, or back out.
      if (this.scale() > 1) this.reset();
      else this.zoomAt(point, CLICK_SCALE);
    }
    if (this.pointers.size === 0) {
      this.gesture = null;
      this.dragging.set(false);
    } else {
      this.startGesture();
    }
  }

  /** A fresh start for whatever pointers are down now. */
  private startGesture(): void {
    const points = [...this.pointers.values()];
    const [a, b] = points;
    this.gesture = {
      startPan: this.pan(),
      startScale: this.scale(),
      startDistance: b ? Math.max(distance(a, b), 1) : 1,
      startMid: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
      moved: points.length > 1,
    };
  }

  /** Zooms to `scale`, keeping the point under `p` where it is. */
  private zoomAt(p: Point, scale: number): void {
    this.applyZoom(p, this.pan(), this.scale(), scale);
  }

  private applyZoom(
    p: Point,
    fromPan: Point,
    fromScale: number,
    toScale: number,
  ): void {
    const scale = Math.min(Math.max(toScale, 1), MAX_SCALE);
    if (scale === 1) return this.reset();
    const k = scale / fromScale;
    this.scale.set(scale);
    this.setPan({
      x: p.x - k * (p.x - fromPan.x),
      y: p.y - k * (p.y - fromPan.y),
    });
  }

  /** Pans, but never so far that the photo leaves the screen. */
  private setPan(p: Point): void {
    const stage = this.stage().nativeElement;
    const img = this.image().nativeElement;
    const scale = this.scale();
    const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(
      0,
      (img.offsetHeight * scale - stage.clientHeight) / 2,
    );
    this.pan.set({
      x: Math.min(Math.max(p.x, -maxX), maxX),
      y: Math.min(Math.max(p.y, -maxY), maxY),
    });
  }

  private reset(): void {
    this.scale.set(1);
    this.pan.set({ x: 0, y: 0 });
  }

  /** A pointer's position relative to the stage's centre. */
  private fromCentre(event: { clientX: number; clientY: number }): Point {
    const r = this.stage().nativeElement.getBoundingClientRect();
    return {
      x: event.clientX - (r.left + r.width / 2),
      y: event.clientY - (r.top + r.height / 2),
    };
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
