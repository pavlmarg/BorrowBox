import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter, map } from 'rxjs';
import { TranslocoDirective } from '@jsverse/transloco';
import { Api } from './api/api';
import { meControllerUpdate } from './api/functions';
import type { Locale } from './api/models';
import { AuthStore } from './core/auth/auth.store';
import { LANGUAGES, LanguageService } from './core/i18n/language';

@Component({
  selector: 'bb-root',
  imports: [
    RouterOutlet,
    RouterLink,
    TranslocoDirective,
    MatToolbarModule,
    MatButtonModule,
    MatMenuModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly auth = inject(AuthStore);
  protected readonly language = inject(LanguageService);
  protected readonly languages = LANGUAGES;
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  /** Register / login / callback: the toolbar turns transparent and minimal. */
  protected readonly onAuthPage = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.startsWith('/auth')),
    ),
    { initialValue: false },
  );

  constructor() {
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

  /** Switches the UI; when signed in, also saves it as the account language. */
  protected setLanguage(lang: Locale): void {
    this.language.use(lang);
    if (this.auth.isAuthenticated() && this.auth.user()?.locale !== lang) {
      this.api
        .invoke(meControllerUpdate, { body: { locale: lang } })
        .then((user) => this.auth.updateUser(user))
        .catch(() => undefined); // The UI already switched; the preference retries next time.
    }
  }

  protected async logout(): Promise<void> {
    await this.auth.logout().catch(() => undefined);
    await this.router.navigateByUrl('/auth/login');
  }
}
