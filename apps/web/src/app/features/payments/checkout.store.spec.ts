import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { PaymentViewResponse } from '../../api/models';
import { tick } from '../../../testing/auth';
import { CheckoutStore } from './checkout.store';

const URL = '/api/bookings/b-1/payment';

const paymentView = (
  overrides: Partial<PaymentViewResponse> = {},
): PaymentViewResponse => ({
  bookingId: 'b-1',
  status: 'REQUIRES_PAYMENT',
  rentCents: 2000,
  depositCents: 5000,
  feeCents: 200,
  chargeCents: 7200,
  payBy: '2026-11-10T10:00:00.000Z',
  lastAttemptFailed: false,
  paidAt: null,
  refundedCents: 0,
  ...overrides,
});

const refusal = (status: number, code: string) =>
  [
    { statusCode: status, code, message: '' },
    { status, statusText: '' },
  ] as const;

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), CheckoutStore],
  });
  return {
    store: TestBed.inject(CheckoutStore),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('CheckoutStore', () => {
  it.each([
    ['REQUIRES_PAYMENT', 'pay', null],
    ['PROCESSING', 'confirming', null],
    ['SUCCEEDED', 'done', null],
    ['SETTLED', 'done', null],
    ['CANCELLED', 'closed', 'payment.closed.cancelled'],
    ['REFUNDED', 'closed', 'payment.closed.refunded'],
  ] as const)('reads %s as %s', async (status, phase, key) => {
    const { store, http } = setup();
    const done = store.load('b-1');
    http.expectOne(URL).flush(paymentView({ status }));
    expect(await done).toBe(phase);
    expect(store.phase()).toBe(phase);
    expect(store.messageKey()).toBe(key);
  });

  it('hands the client secret to the caller without keeping it', async () => {
    const { store, http } = setup();
    const started = store.start('b-1');
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    req.flush({ ...paymentView(), clientSecret: 'pi_1_secret_2' });
    expect(await started).toBe('pi_1_secret_2');
    expect(JSON.stringify(store.view())).not.toContain('secret');
    expect(store.view()?.chargeCents).toBe(7200);
  });

  it.each([
    [409, 'PAYMENT_WINDOW_CLOSED', 'closed'],
    [409, 'INVALID_STATE', 'closed'],
    [404, 'NOT_FOUND', 'closed'],
    [503, 'PROVIDER_UNAVAILABLE', 'error'],
  ])('a %s %s ends in %s', async (status, code, phase) => {
    const { store, http } = setup();
    const started = store.start('b-1');
    http.expectOne(URL).flush(...refusal(status, code));
    expect(await started).toBeNull();
    expect(store.phase()).toBe(phase);
    expect(store.messageKey()).toBe(`payment.errors.${code}`);
  });

  it('falls back to the shared messages for other failures', async () => {
    const { store, http } = setup();
    const started = store.start('b-1');
    http.expectOne(URL).flush(...refusal(429, 'RATE_LIMITED'));
    await started;
    expect(store.phase()).toBe('error');
    expect(store.messageKey()).toBe('errors.RATE_LIMITED');
  });

  describe('awaitOutcome', () => {
    it('looks again until Payments confirms the payment', async () => {
      const { store, http } = setup();
      const done = store.awaitOutcome('b-1', [0, 0, 0]);
      expect(store.phase()).toBe('confirming');
      http.expectOne(URL).flush(paymentView({ status: 'PROCESSING' }));
      await tick();
      await tick();
      // A failed look doesn't end the wait.
      http.expectOne(URL).flush({}, { status: 0, statusText: '' });
      await tick();
      await tick();
      http.expectOne(URL).flush(paymentView({ status: 'SUCCEEDED' }));
      await done;
      expect(store.phase()).toBe('done');
      http.verify();
    });

    it('says the refund is on its way when the booking closed meanwhile', async () => {
      const { store, http } = setup();
      const done = store.awaitOutcome('b-1', []);
      http.expectOne(URL).flush(paymentView({ status: 'NEEDS_REFUND' }));
      await done;
      expect(store.phase()).toBe('closed');
      expect(store.messageKey()).toBe('payment.closed.refunded');
    });

    it('gives up after the last look and says we will email', async () => {
      const { store, http } = setup();
      const done = store.awaitOutcome('b-1', [0]);
      http.expectOne(URL).flush(paymentView({ status: 'REQUIRES_PAYMENT' }));
      await tick();
      await tick();
      http.expectOne(URL).flush(paymentView({ status: 'PROCESSING' }));
      await done;
      expect(store.phase()).toBe('slow');
    });
  });
});
