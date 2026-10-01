import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoDirective } from '@jsverse/transloco';

export interface DeleteAccountDialogData {
  hasPassword: boolean;
}

/** Closes with `{ password }` to confirm (password undefined for accounts without one), or undefined to cancel. */
export type DeleteAccountDialogResult = { password?: string } | undefined;

@Component({
  selector: 'bb-delete-account-dialog',
  imports: [
    ReactiveFormsModule,
    TranslocoDirective,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('deleteDialog.title') }}</h2>
      <mat-dialog-content class="stack">
        <p>{{ t('deleteDialog.body') }}</p>
        @if (data.hasPassword) {
          <mat-form-field class="full-width">
            <mat-label>{{ t('deleteDialog.password') }}</mat-label>
            <input
              matInput
              type="password"
              autocomplete="current-password"
              [formControl]="password"
              (keydown.enter)="confirm()"
            />
            @if (password.hasError('required')) {
              <mat-error>{{ t('validation.required') }}</mat-error>
            }
          </mat-form-field>
        } @else {
          <p class="muted">{{ t('deleteDialog.noPassword') }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>
          {{ t('deleteDialog.cancel') }}
        </button>
        <button mat-flat-button class="danger" (click)="confirm()">
          {{ t('deleteDialog.confirm') }}
        </button>
      </mat-dialog-actions>
    </ng-container>
  `,
  styles: `
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class DeleteAccountDialog {
  protected readonly data = inject<DeleteAccountDialogData>(MAT_DIALOG_DATA);
  private readonly ref =
    inject<MatDialogRef<DeleteAccountDialog, DeleteAccountDialogResult>>(
      MatDialogRef,
    );
  protected readonly password = inject(NonNullableFormBuilder).control(
    '',
    Validators.required,
  );

  protected confirm(): void {
    if (!this.data.hasPassword) {
      this.ref.close({});
      return;
    }
    if (this.password.invalid) {
      this.password.markAsTouched();
      return;
    }
    this.ref.close({ password: this.password.value });
  }
}
