import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  type ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { provideApiConfiguration } from './api/api-configuration';
import { appRoutes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthStore } from './core/auth/auth.store';
import { authSlideDirection } from './core/ui/view-transitions';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LanguageService,
  TranslationLoader,
  initialLanguage,
} from './core/i18n/language';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      appRoutes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      // Animated route changes (CSS in styles.scss); no-op where unsupported.
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: authSlideDirection,
      }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Same origin: the dev server proxies /api to the gateway, Caddy does in production.
    provideApiConfiguration(''),
    provideTransloco({
      config: {
        availableLangs: [...LANGUAGES],
        defaultLang: DEFAULT_LANGUAGE,
        fallbackLang: DEFAULT_LANGUAGE,
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        missingHandler: { logMissingKey: true },
      },
      loader: TranslationLoader,
    }),
    provideAppInitializer(() => {
      inject(LanguageService).use(initialLanguage());
      // Restore the session (refresh cookie) before the first route resolves.
      return inject(AuthStore).init();
    }),
  ],
};
