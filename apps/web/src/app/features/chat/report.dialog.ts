import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';
import { TranslocoDirective } from '@jsverse/transloco';
import { REPORT_REASONS } from '@borrowbox/contracts';
import type { ReportReason } from '../../api/models';

/** Asks why a message is reported; closes with the reason, or undefined. */
@Component({
  selector: 'bb-report-dialog',
  imports: [
    FormsModule,
    TranslocoDirective,
    MatButtonModule,
    MatDialogModule,
    MatRadioModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title id="bb-report-title">
        {{ t('chat.report.title') }}
      </h2>
      <mat-dialog-content>
        <p class="muted">{{ t('chat.report.intro') }}</p>
        <mat-radio-group
          class="reasons"
          aria-labelledby="bb-report-title"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
        >
          @for (r of reasons; track r) {
            <mat-radio-button [value]="r">{{
              t('chat.report.reasons.' + r)
            }}</mat-radio-button>
          }
        </mat-radio-group>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>
          {{ t('chat.report.cancel') }}
        </button>
        <button
          mat-flat-button
          type="button"
          [disabled]="!reason()"
          [mat-dialog-close]="reason()"
        >
          {{ t('chat.report.send') }}
        </button>
      </mat-dialog-actions>
    </ng-container>
  `,
  styles: `
    .muted {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 8px;
    }
    .reasons {
      display: flex;
      flex-direction: column;
    }
  `,
})
export class ReportDialog {
  protected readonly reasons = REPORT_REASONS;
  protected readonly reason = signal<ReportReason | null>(null);
}
