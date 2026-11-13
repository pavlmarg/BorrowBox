import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language';
import { Avatar } from '../../shared/avatar/avatar';
import { ItemCard } from '../../shared/catalog/item-card';
import { MessagePerson } from './message-person';
import { PersonStore } from './person.store';

/**
 * A public profile (ADR-0025): photo, name, bio, a Message button and
 * their items. `own` is the signed-in user's view of their own profile
 * (`/profile`): the same page others see, with "Edit profile" instead of
 * "Message".
 */
@Component({
  selector: 'bb-person-profile',
  imports: [
    DatePipe,
    RouterLink,
    TranslocoDirective,
    MatButtonModule,
    Avatar,
    ItemCard,
    MessagePerson,
  ],
  providers: [PersonStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @switch (store.status()) {
        @case ('loading') {
          <div class="hero" [attr.aria-label]="t('people.loading')">
            <span class="block avatar-block"></span>
            <span class="lines">
              <span class="block line"></span>
              <span class="block line short"></span>
            </span>
          </div>
        }
        @case ('error') {
          <div class="message" role="alert">
            @if (store.error() === 'NOT_FOUND') {
              <h1>{{ t('people.notFound') }}</h1>
              <p>{{ t('people.notFoundHint') }}</p>
              <a mat-flat-button routerLink="/explore">{{
                t('item.backToExplore')
              }}</a>
            } @else {
              <p>{{ t('errors.' + store.error()) }}</p>
              <button mat-stroked-button type="button" (click)="reload()">
                {{ t('explore.retry') }}
              </button>
            }
          </div>
        }
        @case ('ready') {
          @if (store.profile(); as p) {
            <section class="hero">
              <bb-avatar
                class="avatar"
                [size]="112"
                [photoUrl]="p.photo?.large ?? null"
              />
              <div class="who">
                <h1 class="name">{{ p.displayName }}</h1>
                @if (p.bio) {
                  <p class="bio">{{ p.bio }}</p>
                } @else if (own()) {
                  <p class="bio empty">{{ t('people.noBio') }}</p>
                }
                <p class="since">
                  {{
                    t('profile.memberSince', {
                      date:
                        (p.memberSince
                        | date
                          : 'longDate'
                          : undefined
                          : language.formatLocale()),
                    })
                  }}
                </p>
                @if (own()) {
                  <a mat-stroked-button routerLink="/settings">{{
                    t('profile.editProfile')
                  }}</a>
                } @else if (store.items().length > 0) {
                  <bb-message-person [userId]="p.id" [items]="store.items()" />
                }
              </div>
            </section>

            <section class="items">
              <h2>
                {{
                  own()
                    ? t('people.yourItems')
                    : t('people.itemsOf', { name: p.displayName })
                }}
              </h2>
              @if (store.items().length === 0) {
                <p class="empty">{{ t('people.noItems') }}</p>
              } @else {
                <ul class="grid">
                  @for (item of store.items(); track item.id) {
                    <li><bb-item-card [item]="item" /></li>
                  }
                </ul>
              }
            </section>
          }
        }
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
    .hero {
      align-items: center;
      display: flex;
      gap: 32px;
      padding: 8px 0;
    }
    .avatar {
      box-shadow: var(--bb-shadow-sm);
    }
    .who {
      min-width: 0;
    }
    .name {
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      margin: 0 0 8px;
      overflow-wrap: anywhere;
    }
    .bio {
      font: var(--mat-sys-body-large);
      margin: 0 0 8px;
      max-width: 52ch;
      overflow-wrap: anywhere;
      white-space: pre-line;
    }
    .bio.empty,
    .since,
    .empty {
      color: var(--mat-sys-on-surface-variant);
    }
    .since {
      font: var(--mat-sys-body-medium);
      margin: 0 0 16px;
    }
    .items {
      margin-top: 40px;
    }
    .items h2 {
      border-bottom: 1px solid rgb(var(--bb-line-rgb) / 0.08);
      font: var(--mat-sys-title-large);
      margin: 0 0 16px;
      padding-bottom: 12px;
    }
    .grid {
      display: grid;
      gap: 20px 16px;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .message {
      padding: 48px 0;
      text-align: center;
    }
    .message h1 {
      font: var(--mat-sys-headline-small);
      margin: 0 0 8px;
    }
    .message p {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 20px;
    }
    .block {
      background: rgb(var(--bb-line-rgb) / 0.07);
      display: block;
    }
    .avatar-block {
      border-radius: 50%;
      height: 112px;
      width: 112px;
    }
    .lines {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 12px;
    }
    .block.line {
      height: 20px;
      width: 50%;
    }
    .block.line.short {
      width: 30%;
    }

    @media (max-width: 599px) {
      .hero {
        flex-direction: column;
        gap: 20px;
        text-align: center;
      }
      .bio {
        margin-inline: auto;
      }
      .grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `,
})
export class PersonProfile {
  readonly userId = input.required<string>();
  readonly own = input(false);

  protected readonly store = inject(PersonStore);
  protected readonly language = inject(LanguageService);
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);

  constructor() {
    effect(() => void this.store.load(this.userId()));
    effect(() => {
      const p = this.store.profile();
      const app = this.transloco.translate('app.name');
      this.title.setTitle(p ? `${p.displayName} · ${app}` : app);
    });
    inject(DestroyRef).onDestroy(() =>
      this.title.setTitle(this.transloco.translate('app.name')),
    );
  }

  protected reload(): void {
    void this.store.load(this.userId());
  }
}
