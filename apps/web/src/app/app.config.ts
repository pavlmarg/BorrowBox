import {
  provideHttpClient,
  withInterceptors,
  withXhr,
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
  Router,
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
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LanguageService,
  TranslationLoader,
  initialLanguage,
} from './core/i18n/language';

/** The messages list or one of its conversations. */
function isMessagesUrl(url: string): boolean {
  return (
    url === '/messages' ||
    url.startsWith('/messages/') ||
    url.startsWith('/messages?')
  );
}

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
        // Between the messages list and a conversation the layout slides
        // instead: no whole-page fade on top of it.
        onViewTransitionCreated: ({ transition }) => {
          const router = inject(Router);
          const to = router.currentNavigation()?.finalUrl;
          if (
            to &&
            isMessagesUrl(router.url) &&
            isMessagesUrl(router.serializeUrl(to))
          ) {
            transition.skipTransition();
          }
        },
      }),
    ),
    // XHR, not fetch: only XHR reports upload progress (photo uploads).
    provideHttpClient(withXhr(), withInterceptors([authInterceptor])),
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
