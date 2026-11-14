import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { Api } from '../../api/api';
import { conversationsControllerStart } from '../../api/functions';
import type { LenderItemResponse } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { chatError, type ChatError } from '../chat/chat-errors';

/**
 * "Message" on someone's profile (ADR-0025). Chats are always about one of
 * their items (ADR-0017): with one item it opens that conversation, with
 * several it asks which first. The profile leaves it out when they have
 * no items, and on your own profile. Signed out, it goes to sign-in and
 * comes back to the profile.
 */
@Component({
  selector: 'bb-message-person',
  imports: [RouterLink, TranslocoDirective, MatButtonModule, MatMenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (items().length === 1) {
        <button
          mat-flat-button
          type="button"
          [disabled]="busy()"
          (click)="open(items()[0].id)"
        >
          {{ t('people.message') }}
        </button>
      } @else {
        <button
          mat-flat-button
          type="button"
          [disabled]="busy()"
          [matMenuTriggerFor]="which"
        >
          {{ t('people.message') }}
        </button>
        <mat-menu #which="matMenu">
          <p class="menu-title">
            {{ t('people.messageAbout') }}
          </p>
          @for (item of items(); track item.id) {
            <button mat-menu-item type="button" (click)="open(item.id)">
              {{ item.title }}
            </button>
          }
        </mat-menu>
      }
      <p class="status" aria-live="polite">
        @if (error(); as e) {
          <span class="error">{{ t(e.key) }}</span>
          @if (e.code === 'EMAIL_NOT_VERIFIED') {
            <a routerLink="/settings">{{ t('chat.toSettings') }}</a>
          }
        }
      </p>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
    .status {
      font: var(--mat-sys-body-small);
      margin: 6px 0 0;
    }
    .status:empty {
      display: none;
    }
    .error {
      color: var(--mat-sys-error);
      margin-right: 6px;
    }
    .menu-title {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
      margin: 0;
      padding: 8px 16px 4px;
    }
  `,
})
export class MessagePerson {
  readonly userId = input.required<string>();
  /** Their items; at least one. */
  readonly items = input.required<LenderItemResponse[]>();

  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly error = signal<ChatError | null>(null);

  protected async open(itemId: string): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/auth/login'], {
        queryParams: { returnUrl: `/users/${this.userId()}` },
      });
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const conversation = await this.api.invoke(conversationsControllerStart, {
        itemId,
      });
      await this.router.navigate(['/messages', conversation.id]);
    } catch (err) {
      this.error.set(chatError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
