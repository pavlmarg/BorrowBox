import { Injectable, inject } from '@angular/core';
import { Api } from '../../api/api';
import { meControllerUpdate } from '../../api/functions';
import type { Locale } from '../../api/models';
import { AuthStore } from '../auth/auth.store';
import { LanguageService } from './language';

/** The language toggle's action, shared by the auth toolbar and the app shell. */
@Injectable({ providedIn: 'root' })
export class AccountLanguage {
  private readonly auth = inject(AuthStore);
  private readonly language = inject(LanguageService);
  private readonly api = inject(Api);

  /** Switches the UI; when signed in, also saves it as the account language. */
  set(lang: Locale): void {
    this.language.use(lang);
    if (this.auth.isAuthenticated() && this.auth.user()?.locale !== lang) {
      this.api
        .invoke(meControllerUpdate, { body: { locale: lang } })
        .then((user) => this.auth.updateUser(user))
        .catch(() => undefined); // The UI already switched; the preference retries next time.
    }
  }
}
