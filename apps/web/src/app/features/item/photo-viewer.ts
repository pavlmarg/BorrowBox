import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import type { PublicPhotoResponse } from '../../api/models';

export interface PhotoViewerData {
  photo: PublicPhotoResponse;
  title: string;
}

/**
 * One photo, enlarged over the softly blurred page: a click anywhere (or
 * Esc) zooms back out. Opened by the gallery in a MatDialog
 * (`.bb-photo-viewer-panel` in styles.scss).
 */
@Component({
  selector: 'bb-photo-viewer',
  imports: [MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(click)': 'close()' },
  template: `
    <img [src]="data.photo.urls.large" [alt]="data.title" draggable="false" />
  `,
  styles: `
    :host {
      align-items: center;
      box-sizing: border-box;
      cursor: zoom-out;
      display: flex;
      height: 100%;
      justify-content: center;
      padding: 24px;
    }
    img {
      animation: bb-zoom-in 280ms cubic-bezier(0.16, 1, 0.3, 1) both;
      border-radius: 8px;
      box-shadow: 0 20px 50px rgb(0 0 0 / 0.35);
      max-height: 100%;
      max-width: 100%;
      object-fit: contain;
    }
    @keyframes bb-zoom-in {
      from {
        opacity: 0;
        transform: scale(0.8);
      }
    }
  `,
})
export class PhotoViewer {
  protected readonly data = inject<PhotoViewerData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<PhotoViewer>);

  protected close(): void {
    this.ref.close();
  }
}
