import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirm: string;
  cancel: string;
  /** Destructive actions get a red button. */
  danger?: boolean;
}

/**
 * "Are you sure?" with already translated texts: a title, the message and
 * two buttons on a white card. The panel is styled in styles.scss
 * (`.bb-confirm-panel`). Open it with `openConfirm()`.
 */
@Component({
  selector: 'bb-confirm-dialog',
  imports: [MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card" [class.danger]="data.danger">
      <h2 mat-dialog-title class="title">{{ data.title }}</h2>
      <p class="message">{{ data.message }}</p>
      <div class="buttons">
        <button type="button" class="button cancel" [mat-dialog-close]="false">
          {{ data.cancel }}
        </button>
        <button
          type="button"
          class="button confirm"
          cdkFocusInitial
          [mat-dialog-close]="true"
        >
          {{ data.confirm }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .card {
      animation: bb-confirm-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
      padding: 24px;
    }
    @keyframes bb-confirm-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
    /* Material's dialog title has its own padding and line box. */
    .title {
      font: var(--mat-sys-title-large);
      font-weight: 700;
      margin: 0 0 8px;
      padding: 0;
    }
    .title::before {
      display: none;
    }
    .message {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-large);
      margin: 0 0 24px;
    }
    .buttons {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
    .button {
      border-radius: 8px;
      cursor: pointer;
      font: var(--mat-sys-label-large);
      font-size: 15px;
      font-weight: 600;
      height: 42px;
      padding: 0 20px;
      transition:
        background-color var(--bb-medium) var(--bb-ease),
        border-color var(--bb-medium) var(--bb-ease);
    }
    .button:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .cancel {
      background: #fff;
      border: 1px solid rgb(16 58 99 / 0.2);
      color: var(--mat-sys-on-surface);
    }
    .cancel:hover {
      background: var(--bb-sky-50);
      border-color: rgb(16 58 99 / 0.35);
    }
    .confirm {
      background: var(--mat-sys-primary);
      border: 0;
      color: var(--mat-sys-on-primary);
    }
    .confirm:hover {
      background: color-mix(in srgb, var(--mat-sys-primary) 82%, black);
    }
    .danger .confirm {
      background: var(--mat-sys-error);
      color: var(--mat-sys-on-error);
    }
    .danger .confirm:hover {
      background: color-mix(in srgb, var(--mat-sys-error) 82%, black);
    }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}

/** Asks, and resolves to true only when confirmed. */
export async function openConfirm(
  dialog: MatDialog,
  data: ConfirmDialogData,
): Promise<boolean> {
  const answer = await firstValueFrom(
    dialog
      .open(ConfirmDialog, {
        data,
        panelClass: 'bb-confirm-panel',
        backdropClass: 'bb-confirm-backdrop',
        width: '420px',
        maxWidth: 'calc(100vw - 32px)',
      })
      .afterClosed(),
  );
  return answer === true;
}
