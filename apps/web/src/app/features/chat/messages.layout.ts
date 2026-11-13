import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { ConversationsPage } from './conversations.page';

/** `/messages/<id>` → the id; `/messages` → null. */
export function openConversationId(url: string): string | null {
  const match = /^\/messages\/([^/?#]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * `/messages` and `/messages/:id` (Instagram-like). Alone, the list fills the
 * page. Opening a conversation slides the list into a scrollable column on
 * the left while the conversation takes the rest of the screen; the list
 * stays in place (and keeps its scroll) when switching conversations.
 * Phones show one at a time.
 */
@Component({
  selector: 'bb-messages-layout',
  imports: [RouterOutlet, ConversationsPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="layout" [class.open]="openId() !== null">
      <section class="list-pane">
        <bb-conversations-page class="list" [activeId]="openId()" />
      </section>
      <section class="thread-pane">
        @if (openId(); as id) {
          <!-- A new conversation slides in each time. -->
          @for (key of [id]; track key) {
            <div class="thread-enter">
              <router-outlet />
            </div>
          }
        } @else {
          <router-outlet />
        }
      </section>
    </div>
  `,
  styles: `
    :host {
      /* Opening a conversation: slow and even, so the list visibly glides aside. */
      --slide: 700ms cubic-bezier(0.4, 0, 0.2, 1);
      display: block;
      /* The screen under the top bar: each pane scrolls on its own. */
      height: calc(100dvh - 64px);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 0fr);
      height: 100%;
      transition: grid-template-columns var(--slide);
    }
    .list-pane {
      min-width: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .list {
      box-sizing: border-box;
      display: block;
      margin: 0 auto;
      max-width: 960px;
      padding: 32px 40px 48px;
      transition: padding var(--slide);
    }
    .thread-pane {
      min-width: 0;
      overflow: hidden;
    }
    .thread-enter {
      animation: bb-thread-in var(--slide) both;
      height: 100%;
    }
    .thread-enter > :not(router-outlet) {
      height: 100%;
    }
    @keyframes bb-thread-in {
      from {
        opacity: 0;
        transform: translateX(32px);
      }
    }

    /* Wide screens: the list becomes a column on the left. */
    @media (min-width: 960px) {
      .layout.open {
        grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
      }
      .layout.open .list {
        padding: 20px 12px 24px;
      }
      .layout.open .thread-pane {
        border-left: 1px solid var(--mat-sys-outline-variant);
      }
    }
    /* Phones and narrow windows: one at a time, no sliding columns. */
    @media (max-width: 959px) {
      .layout,
      .layout.open {
        grid-template-columns: minmax(0, 1fr);
        transition: none;
      }
      .list {
        padding: 20px 16px 40px;
      }
      .layout.open .list-pane,
      .layout:not(.open) .thread-pane {
        display: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .layout,
      .list {
        transition: none;
      }
      .thread-enter {
        animation: none;
      }
    }
  `,
})
export class MessagesLayout {
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  /** The conversation open beside the list, from the URL. */
  protected readonly openId = computed(() => openConversationId(this.url()));
}
