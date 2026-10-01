import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { AuthStore } from './core/auth/auth.store';
import { AccountLanguage } from './core/i18n/account-language';
import { LANGUAGES, LanguageService } from './core/i18n/language';
import { LanguageToggle } from './core/i18n/language-toggle';

@Component({
  selector: 'bb-root',
  imports: [RouterOutlet, LanguageToggle],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly accountLanguage = inject(AccountLanguage);
  private readonly auth = inject(AuthStore);
  private readonly language = inject(LanguageService);
  private readonly router = inject(Router);

  /** Register / login / callback show a floating language switch. */
  protected readonly onAuthPage = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.startsWith('/auth')),
    ),
    { initialValue: false },
  );

  constructor() {
    // Load every language up front so the flag toggle switches instantly.
    const transloco = inject(TranslocoService);
    for (const lang of LANGUAGES) transloco.load(lang).subscribe();

    // Signing in adopts the account's language.
    let lastUserId: string | null = null;
    effect(() => {
      const user = this.auth.user();
      if (user && user.id !== lastUserId) {
        untracked(() => this.language.use(user.locale));
      }
      lastUserId = user?.id ?? null;
    });
  }
}
