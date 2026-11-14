import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTransloco } from '@jsverse/transloco';
import type { PayoutAccountResponse } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { testUser, tick } from '../../../testing/auth';
import { LEAVE_FOR } from './leave-for';
import { PayoutsPage } from './payouts.page';

const account = (
  status: PayoutAccountResponse['status'],
): PayoutAccountResponse => ({
  status,
  payoutsEnabled: status === 'READY',
  updatedAt: '2026-11-09T10:00:00.000Z',
});

async function render(
  status: PayoutAccountResponse['status'],
  { query = '', emailVerified = true } = {},
) {
  const leaveFor = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: 'settings/payouts', component: PayoutsPage }]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      {
        provide: AuthStore,
        useValue: { user: signal({ ...testUser, emailVerified }) },
      },
      { provide: LEAVE_FOR, useValue: leaveFor },
    ],
  });
  const router = TestBed.inject(Router);
  const http = TestBed.inject(HttpTestingController);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`/settings/payouts${query}`, PayoutsPage);
  http.expectOne('/api/me/payouts').flush(account(status));
  await tick();
  const fixture = harness.fixture;
  await fixture.whenStable();
  const el = harness.routeNativeElement as HTMLElement;
  const buttons = () =>
    [...el.querySelectorAll('button')].map((b) => ({
      text: b.textContent?.trim(),
      disabled: b.disabled,
    }));
  return { fixture, el, http, router, leaveFor, buttons };
}

describe('PayoutsPage', () => {
  it('offers to set up payouts when not started', async () => {
    const { el, buttons } = await render('NOT_STARTED');
    expect(el.querySelector('.status-title')?.textContent).toContain(
      'payouts.status.NOT_STARTED.title',
    );
    expect(buttons()).toEqual([{ text: 'payouts.setUp', disabled: false }]);
  });

  it('sends the lender to Stripe with a fresh onboarding link', async () => {
    const { el, fixture, http, leaveFor } = await render('INCOMPLETE');
    (el.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.textContent).toContain('payouts.opening');
    http.expectOne('/api/me/payouts/onboarding').flush({
      url: 'https://connect.stripe.com/setup/e/abc',
      expiresAt: null,
    });
    await tick();
    expect(leaveFor).toHaveBeenCalledWith(
      'https://connect.stripe.com/setup/e/abc',
    );
  });

  it('opens the dashboard once the details were sent', async () => {
    const { el, fixture, http, leaveFor, buttons } = await render('READY');
    expect(buttons()).toEqual([{ text: 'payouts.dashboard', disabled: false }]);
    (el.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    http
      .expectOne('/api/me/payouts/dashboard')
      .flush({ url: 'https://connect.stripe.com/express/x', expiresAt: null });
    await tick();
    expect(leaveFor).toHaveBeenCalledWith(
      'https://connect.stripe.com/express/x',
    );
  });

  it('asks to verify the email before setting up', async () => {
    const { el, buttons } = await render('NOT_STARTED', {
      emailVerified: false,
    });
    expect(el.textContent).toContain('payouts.verifyFirst');
    expect(buttons()).toEqual([{ text: 'payouts.setUp', disabled: true }]);
  });

  it('offers a new link when Stripe says the old one expired, and clears the query', async () => {
    const { el, router } = await render('INCOMPLETE', {
      query: '?stripe=refresh',
    });
    expect(router.url).toBe('/settings/payouts');
    expect(el.textContent).toContain('payouts.continue');
  });

  it('shows a Stripe outage in words', async () => {
    const { el, fixture, http } = await render('NOT_STARTED');
    (el.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    http
      .expectOne('/api/me/payouts/onboarding')
      .flush(
        { statusCode: 503, code: 'PROVIDER_UNAVAILABLE', message: '' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await tick();
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain(
      'payouts.errors.PROVIDER_UNAVAILABLE',
    );
  });
});
