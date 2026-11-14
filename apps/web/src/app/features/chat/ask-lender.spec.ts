import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { AuthStore } from '../../core/auth/auth.store';
import { tick } from '../../../testing/auth';
import { ITEM_ID, conversation } from '../../../testing/chat';
import { AskLender } from './ask-lender';

async function render(signedIn: boolean) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      { provide: AuthStore, useValue: { isAuthenticated: signal(signedIn) } },
    ],
  });
  const fixture = TestBed.createComponent(AskLender);
  fixture.componentRef.setInput('itemId', ITEM_ID);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  return {
    fixture,
    el,
    navigate,
    http: TestBed.inject(HttpTestingController),
    click: () => (el.querySelector('button') as HTMLButtonElement).click(),
  };
}

describe('AskLender', () => {
  it('sends visitors to sign in, coming back to the item', async () => {
    const { click, navigate, http } = await render(false);
    click();
    await tick();
    expect(navigate).toHaveBeenCalledWith(['/auth/login'], {
      queryParams: { returnUrl: `/items/${ITEM_ID}` },
    });
    http.verify();
  });

  it('opens the conversation, started if new', async () => {
    const { click, navigate, http } = await render(true);
    click();
    http
      .expectOne(`/api/items/${ITEM_ID}/conversations`)
      .flush(conversation({ id: 'c-9' }));
    await tick();
    expect(navigate).toHaveBeenCalledWith(['/messages', 'c-9']);
  });

  it('points to Settings when the email is not verified yet', async () => {
    const { click, http, el, fixture } = await render(true);
    click();
    http
      .expectOne(`/api/items/${ITEM_ID}/conversations`)
      .flush(
        { statusCode: 403, code: 'EMAIL_NOT_VERIFIED', message: 'x' },
        { status: 403, statusText: 'Forbidden' },
      );
    await tick();
    await fixture.whenStable();
    expect(el.textContent).toContain('errors.EMAIL_NOT_VERIFIED');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/settings');
  });
});
