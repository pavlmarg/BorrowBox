import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { PublicPhotoResponse } from '../../api/models';

/**
 * An item's photos: swipe (scroll-snap, no library) on phones, arrows and
 * thumbnails on bigger screens. Photos are decorative next to the title,
 * so they carry the title as alt text only on the first one.
 */
@Component({
  selector: 'bb-item-gallery',
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gallery" *transloco="let t">
      <div class="track" #track (scroll)="onScroll()">
        @for (photo of photos(); track photo.id; let i = $index) {
          <img
            class="slide"
            [src]="photo.urls.medium"
            [attr.srcset]="
              photo.urls.medium + ' 800w, ' + photo.urls.large + ' 1600w'
            "
            sizes="(min-width: 960px) 560px, 100vw"
            [alt]="i === 0 ? title() : ''"
            [attr.loading]="i === 0 ? 'eager' : 'lazy'"
          />
        } @empty {
          <div class="slide empty"></div>
        }
      </div>

      @if (photos().length > 1) {
        <button
          type="button"
          class="arrow prev"
          [disabled]="index() === 0"
          [attr.aria-label]="t('item.previousPhoto')"
          (click)="go(index() - 1)"
        >
          <span class="chevron left" aria-hidden="true"></span>
        </button>
        <button
          type="button"
          class="arrow next"
          [disabled]="index() === photos().length - 1"
          [attr.aria-label]="t('item.nextPhoto')"
          (click)="go(index() + 1)"
        >
          <span class="chevron right" aria-hidden="true"></span>
        </button>
        <span class="counter" aria-live="polite">
          {{ t('item.photoCount', { n: index() + 1, total: photos().length }) }}
        </span>

        <div class="thumbs">
          @for (photo of photos(); track photo.id; let i = $index) {
            <button
              type="button"
              class="thumb"
              [class.current]="i === index()"
              [attr.aria-label]="
                t('item.photoCount', { n: i + 1, total: photos().length })
              "
              [attr.aria-current]="i === index()"
              (click)="go(i)"
            >
              <img [src]="photo.urls.small" alt="" loading="lazy" />
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .gallery {
      position: relative;
    }
    .track {
      aspect-ratio: 4 / 3;
      background: var(--bb-sky-100);
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
    }
    .slide {
      flex: none;
      height: 100%;
      object-fit: cover;
      scroll-snap-align: start;
      width: 100%;
    }
    .arrow {
      align-items: center;
      background: rgb(255 255 255 / 0.9);
      border: 0;
      border-radius: var(--bb-button-radius);
      box-shadow: var(--bb-shadow-sm);
      cursor: pointer;
      display: flex;
      height: 40px;
      justify-content: center;
      position: absolute;
      top: calc(50% - 20px - 40px);
      width: 40px;
    }
    .arrow:disabled {
      opacity: 0;
      pointer-events: none;
    }
    .prev {
      left: 12px;
    }
    .next {
      right: 12px;
    }
    .chevron {
      border-bottom: 2px solid currentColor;
      border-right: 2px solid currentColor;
      height: 9px;
      width: 9px;
    }
    .chevron.left {
      margin-left: 4px;
      transform: rotate(135deg);
    }
    .chevron.right {
      margin-right: 4px;
      transform: rotate(-45deg);
    }
    .counter {
      background: rgb(16 58 99 / 0.7);
      bottom: calc(80px + 12px);
      color: #fff;
      font: var(--mat-sys-label-medium);
      padding: 2px 8px;
      position: absolute;
      right: 12px;
    }
    .thumbs {
      display: flex;
      gap: 8px;
      height: 72px;
      margin-top: 8px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .thumb {
      background: none;
      border: 2px solid transparent;
      cursor: pointer;
      flex: none;
      height: 72px;
      padding: 0;
      width: 72px;
    }
    .thumb.current {
      border-color: var(--bb-sky-700);
    }
    .thumb img {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    @media (max-width: 599px) {
      .arrow,
      .thumbs {
        display: none;
      }
      .counter {
        bottom: 12px;
      }
    }
  `,
})
export class ItemGallery {
  readonly photos = input.required<readonly PublicPhotoResponse[]>();
  readonly title = input.required<string>();

  protected readonly index = signal(0);
  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  protected onScroll(): void {
    const el = this.track()?.nativeElement;
    if (el && el.clientWidth > 0) {
      this.index.set(Math.round(el.scrollLeft / el.clientWidth));
    }
  }

  protected go(i: number): void {
    const el = this.track()?.nativeElement;
    const target = Math.max(0, Math.min(i, this.photos().length - 1));
    this.index.set(target);
    el?.scrollTo({ left: target * el.clientWidth });
  }
}
