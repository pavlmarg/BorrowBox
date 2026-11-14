import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { Api } from '../../api/api';
import { conversationsControllerStart } from '../../api/functions';
import { AuthStore } from '../../core/auth/auth.store';
import { chatError, type ChatError } from './chat-errors';

/**
 * "Ask the lender" on an item's page (ADR-0017): opens my conversation
 * about the item, starting it if new. Signed out, it goes to sign-in and
 * comes back here. The item page leaves it out for the item's owner.
 */
@Component({
  selector: 'bb-ask-lender',
  imports: [RouterLink, TranslocoDirective, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <button
        mat-stroked-button
        type="button"
        class="ask"
        [disabled]="busy()"
        (click)="ask()"
      >
        {{ t('chat.ask') }}
      </button>
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
    .ask {
      margin-top: 12px;
      width: 100%;
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
  `,
})
export class AskLender {
  readonly itemId = input.required<string>();

  private readonly api = inject(Api);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly error = signal<ChatError | null>(null);

  protected async ask(): Promise<void> {
    const itemId = this.itemId();
    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/auth/login'], {
        queryParams: { returnUrl: `/items/${itemId}` },
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
