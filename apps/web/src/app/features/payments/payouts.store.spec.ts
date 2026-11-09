import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { PayoutAccountResponse } from '../../api/models';
import { tick } from '../../../testing/auth';
import { PayoutsStore } from './payouts.store';

const account = (
  status: PayoutAccountResponse['status'],
): PayoutAccountResponse => ({
  status,
  payoutsEnabled: status === 'READY',
  updatedAt: null,
});

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), PayoutsStore],
  });
  return {
    store: TestBed.inject(PayoutsStore),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('PayoutsStore', () => {
  it('loads the account', async () => {
    const { store, http } = setup();
    const done = store.load();
    http.expectOne('/api/me/payouts').flush(account('INCOMPLETE'));
    await done;
    expect(store.status()).toBe('ready');
    expect(store.account()?.status).toBe('INCOMPLETE');
  });

  it('after a return from Stripe, looks again until payouts are ready', async () => {
    const { store, http } = setup();
    const done = store.refreshAfterReturn([0, 0, 0, 0]);
    expect(store.refreshing()).toBe(true);
    http.expectOne('/api/me/payouts').flush(account('INCOMPLETE'));
    await tick();
    await tick();
    http.expectOne('/api/me/payouts').flush(account('PENDING'));
    await tick();
    await tick();
    http.expectOne('/api/me/payouts').flush(account('READY'));
    await done;
    http.verify(); // no fourth look
    expect(store.account()?.status).toBe('READY');
    expect(store.refreshing()).toBe(false);
  });

  it('keeps what it showed when a background look fails', async () => {
    const { store, http } = setup();
    const first = store.load();
    http.expectOne('/api/me/payouts').flush(account('PENDING'));
    await first;
    const again = store.load(true);
    http
      .expectOne('/api/me/payouts')
      .flush({}, { status: 0, statusText: 'Unknown Error' });
    await again;
    expect(store.status()).toBe('ready');
    expect(store.errorKey()).toBeNull();
  });

  it('hands back the onboarding link and stays busy while the browser leaves', async () => {
    const { store, http } = setup();
    const link = store.onboardingLink();
    expect(store.busy()).toBe('onboarding');
    const req = http.expectOne('/api/me/payouts/onboarding');
    expect(req.request.method).toBe('POST');
    req.flush({ url: 'https://connect.stripe.com/setup/x', expiresAt: null });
    expect(await link).toBe('https://connect.stripe.com/setup/x');
    expect(store.busy()).toBe('onboarding');
  });

  it.each([
    [503, 'PROVIDER_UNAVAILABLE', 'payouts.errors.PROVIDER_UNAVAILABLE'],
    [403, 'EMAIL_NOT_VERIFIED', 'payouts.errors.EMAIL_NOT_VERIFIED'],
    [429, 'RATE_LIMITED', 'errors.RATE_LIMITED'],
  ])('explains a %s %s', async (status, code, key) => {
    const { store, http } = setup();
    const link = store.onboardingLink();
    http
      .expectOne('/api/me/payouts/onboarding')
      .flush(
        { statusCode: status, code, message: '' },
        { status, statusText: '' },
      );
    expect(await link).toBeNull();
    expect(store.busy()).toBeNull();
    expect(store.errorKey()).toBe(key);
  });

  it('refuses the dashboard before the details were sent', async () => {
    const { store, http } = setup();
    const link = store.dashboardLink();
    http
      .expectOne('/api/me/payouts/dashboard')
      .flush(
        { statusCode: 409, code: 'PAYOUTS_NOT_SET_UP', message: '' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(await link).toBeNull();
    expect(store.errorKey()).toBe('payouts.errors.PAYOUTS_NOT_SET_UP');
  });
});
