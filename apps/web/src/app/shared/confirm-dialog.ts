import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirm: string;
  cancel: string;
  /** Destructive actions get the error colour. */
  danger?: boolean;
}

/**
 * "Are you sure?" with already translated texts. Closes with `true` when
 * confirmed: `dialog.open(ConfirmDialog, { data }).afterClosed()`.
 */
@Component({
  selector: 'bb-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="false">
        {{ data.cancel }}
      </button>
      <button
        mat-flat-button
        type="button"
        cdkFocusInitial
        [class.danger]="data.danger"
        [mat-dialog-close]="true"
      >
        {{ data.confirm }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    p {
      margin: 0;
    }
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
