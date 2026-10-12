import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { NavIcon } from '../core/layout/nav-icon';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirm: string;
  cancel: string;
  /** Destructive actions get a bin badge and a red button. */
  danger?: boolean;
}

/**
 * "Are you sure?" with already translated texts: a rounded card with an
 * icon badge, a centred title and message, and two round buttons. Styled
 * in styles.scss (`.bb-confirm-panel`). Open it with `openConfirm()`.
 */
@Component({
  selector: 'bb-confirm-dialog',
  imports: [MatDialogModule, NavIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card" [class.danger]="data.danger">
      @if (data.danger) {
        <span class="badge" aria-hidden="true">
          <bb-nav-icon name="trash" />
        </span>
      }
      <h2 mat-dialog-title class="title">{{ data.title }}</h2>
      <p class="message">{{ data.message }}</p>
      <div class="buttons">
        <button type="button" class="pill cancel" [mat-dialog-close]="false">
          {{ data.cancel }}
        </button>
        <button
          type="button"
          class="pill confirm"
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
      align-items: center;
      animation: bb-confirm-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both;
      display: flex;
      flex-direction: column;
      padding: 28px 28px 24px;
      text-align: center;
    }
    @keyframes bb-confirm-in {
      from {
        opacity: 0;
        transform: scale(0.94) translateY(6px);
      }
    }
    .badge {
      align-items: center;
      background: color-mix(in srgb, var(--mat-sys-error) 10%, white);
      border-radius: 50%;
      box-shadow: 0 0 0 8px color-mix(in srgb, var(--mat-sys-error) 5%, white);
      color: var(--mat-sys-error);
      display: inline-flex;
      height: 56px;
      justify-content: center;
      margin-bottom: 20px;
      width: 56px;
    }
    .badge bb-nav-icon {
      --bb-icon-stroke: 2;
      height: 28px;
      width: 28px;
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
      max-width: 34ch;
    }
    .buttons {
      display: grid;
      gap: 12px;
      grid-template-columns: 1fr 1fr;
      width: 100%;
    }
    .pill {
      border-radius: 999px;
      cursor: pointer;
      font: var(--mat-sys-label-large);
      font-size: 15px;
      font-weight: 600;
      height: 46px;
      padding: 0 20px;
      transition:
        background-color var(--bb-medium) var(--bb-ease),
        border-color var(--bb-medium) var(--bb-ease),
        box-shadow var(--bb-medium) var(--bb-ease),
        transform var(--bb-medium) var(--bb-ease);
    }
    .pill:focus-visible {
      outline: 3px solid var(--bb-sky-300);
      outline-offset: 2px;
    }
    .cancel {
      background: #fff;
      border: 1.5px solid var(--bb-sky-200);
      color: var(--mat-sys-on-surface);
    }
    .cancel:hover {
      background: var(--bb-sky-50);
      border-color: var(--bb-sky-300);
    }
    .confirm {
      background: var(--mat-sys-primary);
      border: 0;
      box-shadow: 0 6px 16px
        color-mix(in srgb, var(--mat-sys-primary) 30%, transparent);
      color: var(--mat-sys-on-primary);
    }
    .danger .confirm {
      background: var(--mat-sys-error);
      box-shadow: 0 6px 16px
        color-mix(in srgb, var(--mat-sys-error) 30%, transparent);
      color: var(--mat-sys-on-error);
    }
    .confirm:hover {
      background: color-mix(in srgb, var(--mat-sys-primary) 82%, black);
      transform: translateY(-1px);
    }
    .danger .confirm:hover {
      background: color-mix(in srgb, var(--mat-sys-error) 82%, black);
    }
    @media (max-width: 399px) {
      .buttons {
        grid-template-columns: 1fr;
      }
      .confirm {
        order: -1;
      }
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
