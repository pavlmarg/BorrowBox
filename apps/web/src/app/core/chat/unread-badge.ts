import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UnreadStore } from './unread.store';

/**
 * The unread count on the Messages link (top bar and drawer). Nothing when
 * there's nothing unread. Screen readers hear "3 unread messages".
 */
@Component({
  selector: 'bb-unread-badge',
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (total() > 0) {
      <span class="badge" *transloco="let t">
        <span aria-hidden="true">{{ total() > 99 ? '99+' : total() }}</span>
        <span class="visually-hidden">{{
          t('chat.unreadBadge', { count: total() })
        }}</span>
      </span>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .badge {
      background: var(--mat-sys-primary);
      border-radius: var(--bb-radius);
      color: var(--mat-sys-on-primary);
      font: var(--mat-sys-label-small);
      font-weight: 700;
      margin-left: auto;
      min-width: 18px;
      padding: 1px 5px;
      text-align: center;
    }
    .visually-hidden {
      clip-path: inset(50%);
      height: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
      width: 1px;
    }
  `,
})
export class UnreadBadge {
  protected readonly total = inject(UnreadStore).total;
}
