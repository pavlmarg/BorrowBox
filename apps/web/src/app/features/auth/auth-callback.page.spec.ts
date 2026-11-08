import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { translations } from '../../../testing/auth';
import { AuthCallbackPage } from './auth-callback.page';

describe('AuthCallbackPage', () => {
  beforeEach(() => sessionStorage.clear());

  async function render(error: string) {
    TestBed.configureTestingModule({
      imports: [
        AuthCallbackPage,
        TranslocoTestingModule.forRoot({
          langs: { el: translations('el'), en: translations('en') },
          translocoConfig: { availableLangs: ['el', 'en'], defaultLang: 'en' },
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    const fixture = TestBed.createComponent(AuthCallbackPage);
    fixture.componentRef.setInput('error', error);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows why Google sign-in failed, and keeps where it started for a retry', async () => {
    sessionStorage.setItem('bb.returnUrl', '/items/42');
    const el = await render('RATE_LIMITED');

    expect(el.textContent).toContain('Too many attempts');
    expect(sessionStorage.getItem('bb.returnUrl')).toBeNull();

    // jsdom can't navigate: stop the link's default once the handler ran.
    el.addEventListener('click', (e) => e.preventDefault());
    el.querySelector<HTMLAnchorElement>('a.google')?.click();
    expect(sessionStorage.getItem('bb.returnUrl')).toBe('/items/42');
    expect(el.querySelector('a.back')?.getAttribute('href')).toBe(
      '/auth/login?returnUrl=%2Fitems%2F42',
    );
  });

  it('shows the generic failure for a code it does not know', async () => {
    const el = await render('SOMETHING_ELSE');
    expect(el.textContent).toContain("Google sign-in didn't work");
  });
});
