import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import type {
  LenderItemResponse,
  PublicProfileResponse,
} from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { tick } from '../../../testing/auth';
import { PersonProfile } from './person-profile';

const profile = (
  overrides: Partial<PublicProfileResponse> = {},
): PublicProfileResponse => ({
  id: 'p-1',
  displayName: 'Maria',
  photo: null,
  bio: 'Message me after 9\nWeekends only',
  memberSince: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const item = (id: string, title: string): LenderItemResponse => ({
  id,
  title,
  category: 'tools',
  pricing: { free: false, dailyCents: 500 },
  depositCents: 0,
  coverPhoto: null,
});

async function render(options: { own?: boolean; signedIn?: boolean } = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      {
        provide: AuthStore,
        useValue: {
          user: signal(options.signedIn ? { id: 'me' } : null),
          isAuthenticated: signal(options.signedIn ?? false),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(PersonProfile);
  fixture.componentRef.setInput('userId', 'p-1');
  fixture.componentRef.setInput('own', options.own ?? false);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  const respond = async (
    p: PublicProfileResponse | 'missing',
    items: LenderItemResponse[] = [],
  ) => {
    const get = http.expectOne('/api/users/p-1');
    if (p === 'missing') {
      get.flush(
        { statusCode: 404, code: 'NOT_FOUND', message: 'Profile not found' },
        { status: 404, statusText: 'Not Found' },
      );
    } else {
      get.flush(p);
    }
    http.expectOne('/api/users/p-1/items').flush({ items });
    await tick();
    await fixture.whenStable();
  };
  return { fixture, el: fixture.nativeElement as HTMLElement, http, respond };
}

describe('PersonProfile (ADR-0025)', () => {
  it('shows the photo, name, bio and items, with a Message button', async () => {
    const { el, respond } = await render();
    await respond(profile(), [item('i-1', 'Drill'), item('i-2', 'Ladder')]);
    expect(el.querySelector('h1')?.textContent).toContain('Maria');
    expect(el.querySelector('.bio')?.textContent).toContain(
      'Message me after 9\nWeekends only',
    );
    expect(el.querySelector('.items h2')?.textContent).toContain(
      'people.itemsOf',
    );
    expect(el.querySelectorAll('bb-item-card').length).toBe(2);
    expect(el.querySelector('bb-message-person')).not.toBeNull();
    expect(el.querySelector('a[href="/settings"]')).toBeNull();
  });

  it('has no Message button without items', async () => {
    const { el, respond } = await render();
    await respond(profile({ bio: null }), []);
    expect(el.querySelector('bb-message-person')).toBeNull();
    expect(el.querySelector('.bio')).toBeNull();
    expect(el.textContent).toContain('people.noItems');
  });

  it('shows my own profile with Edit profile instead of Message', async () => {
    const { el, respond } = await render({ own: true, signedIn: true });
    await respond(profile({ bio: null }), [item('i-1', 'Drill')]);
    expect(el.querySelector('bb-message-person')).toBeNull();
    expect(el.querySelector('a[href="/settings"]')?.textContent).toContain(
      'profile.editProfile',
    );
    expect(el.querySelector('.bio.empty')?.textContent).toContain(
      'people.noBio',
    );
    expect(el.querySelector('.items h2')?.textContent).toContain(
      'people.yourItems',
    );
  });

  it('says when the profile does not exist', async () => {
    const { el, respond } = await render();
    await respond('missing');
    expect(el.textContent).toContain('people.notFound');
  });

  it('opens the chat about their only item, and sends visitors to sign in first', async () => {
    const visitor = await render();
    await visitor.respond(profile(), [item('i-1', 'Drill')]);
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    (
      visitor.el.querySelector('bb-message-person button') as HTMLButtonElement
    ).click();
    await tick();
    expect(navigate).toHaveBeenCalledWith(['/auth/login'], {
      queryParams: { returnUrl: '/users/p-1' },
    });
  });

  it('starts the conversation about the item when signed in', async () => {
    const { el, http, respond } = await render({ signedIn: true });
    await respond(profile(), [item('i-1', 'Drill')]);
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    (el.querySelector('bb-message-person button') as HTMLButtonElement).click();
    await tick();
    http.expectOne('/api/items/i-1/conversations').flush({ id: 'c-1' });
    await tick();
    expect(navigate).toHaveBeenCalledWith(['/messages', 'c-1']);
  });
});
