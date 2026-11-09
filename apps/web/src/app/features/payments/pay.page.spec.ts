import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import type { PaymentViewResponse } from '../../api/models';
import { tick } from '../../../testing/auth';
import { PayPage } from './pay.page';
import { StripeLoader } from './stripe-loader';

const URL = '/api/bookings/b-1/payment';

const view = (
  overrides: Partial<PaymentViewResponse> = {},
): PaymentViewResponse => ({
  bookingId: 'b-1',
  status: 'REQUIRES_PAYMENT',
  rentCents: 2000,
  depositCents: 5000,
  feeCents: 217,
  chargeCents: 7217,
  payBy: new Date(Date.now() + 3 * 3_600_000 + 5 * 60_000).toISOString(),
  lastAttemptFailed: false,
  paidAt: null,
  refundedCents: 0,
  ...overrides,
});

/** Just enough of Stripe.js: one Payment Element that is ready at once. */
function fakeStripe(confirmResult: unknown = {}) {
  const handlers: Record<string, () => void> = {};
  const element = {
    on: (event: string, fn: () => void) => (handlers[event] = fn),
    mount: jest.fn(() => handlers['ready']?.()),
    destroy: jest.fn(),
  };
  const elements = {
    create: jest.fn(() => element),
    update: jest.fn(() => Promise.resolve()),
  };
  return {
    element,
    elements,
    stripe: {
      elements: jest.fn(() => elements),
      confirmPayment: jest.fn(() => Promise.resolve(confirmResult)),
    },
  };
}

async function render({
  query = {} as Record<string, string>,
  stripe = fakeStripe().stripe as unknown,
} = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ id: 'b-1' }),
            queryParamMap: convertToParamMap(query),
          },
        },
      },
      {
        provide: StripeLoader,
        useValue: { load: () => Promise.resolve(stripe) },
      },
    ],
  });
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const replaceState = jest.spyOn(TestBed.inject(Location), 'replaceState');
  const fixture = TestBed.createComponent(PayPage);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await tick();
    await tick();
    await fixture.whenStable();
  };
  return { fixture, http, el, navigate, replaceState, settle };
}

/** Answers the first look and the start of paying. */
async function openForm(
  r: Awaited<ReturnType<typeof render>>,
  current = view(),
) {
  r.http.expectOne({ url: URL, method: 'GET' }).flush(current);
  await r.settle();
  r.http
    .expectOne({ url: URL, method: 'POST' })
    .flush({ ...current, clientSecret: 'pi_1_secret_2' });
  await r.settle();
}

describe('PayPage', () => {
  it('shows what is charged, the pay-by time and Stripe’s form', async () => {
    const fake = fakeStripe();
    const r = await render({ stripe: fake.stripe });
    await openForm(r);

    const rows = [...r.el.querySelectorAll('.summary .row')].map((row) =>
      [...row.children]
        .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim())
        .join(' | '),
    );
    expect(rows).toEqual([
      'payment.rent | €20',
      'payment.fee | €2.17',
      'payment.deposit payment.depositHint | €50',
      'payment.total | €72.17',
    ]);
    expect(r.el.querySelector('.left')?.textContent).toContain(
      'payment.leftHours',
    );
    expect(fake.stripe.elements).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: 'pi_1_secret_2', locale: 'en' }),
    );
    expect(fake.element.mount).toHaveBeenCalled();
    const pay = r.el.querySelector('button.pay') as HTMLButtonElement;
    expect(pay.disabled).toBe(false);
    expect(r.el.querySelector('form')?.hidden).toBe(false);
  });

  it('pays, waits for Payments, then goes to the booking', async () => {
    const fake = fakeStripe({ paymentIntent: { status: 'succeeded' } });
    const r = await render({ stripe: fake.stripe });
    await openForm(r);

    (r.el.querySelector('button.pay') as HTMLButtonElement).click();
    await r.settle();
    expect(fake.stripe.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        redirect: 'if_required',
        confirmParams: {
          return_url: `${window.location.origin}/bookings/b-1/pay`,
        },
      }),
    );
    r.http
      .expectOne({ url: URL, method: 'GET' })
      .flush(view({ status: 'SUCCEEDED' }));
    await r.settle();
    expect(r.navigate).toHaveBeenCalledWith(['/bookings', 'b-1'], {
      replaceUrl: true,
    });
  });

  it('shows Stripe’s own message for a refused card', async () => {
    const fake = fakeStripe({
      error: {
        type: 'card_error',
        code: 'card_declined',
        message: 'Your card was declined.',
      },
    });
    const r = await render({ stripe: fake.stripe });
    await openForm(r);

    (r.el.querySelector('button.pay') as HTMLButtonElement).click();
    await r.settle();
    expect(r.el.querySelector('form [role=alert]')?.textContent).toContain(
      'Your card was declined.',
    );
    r.http.verify(); // no polling after a refusal
  });

  it('after a 3-D Secure redirect, clears Stripe’s parameters and waits for the outcome', async () => {
    const fake = fakeStripe();
    const r = await render({
      stripe: fake.stripe,
      query: {
        payment_intent: 'pi_1',
        payment_intent_client_secret: 'pi_1_secret_2',
        redirect_status: 'succeeded',
      },
    });
    expect(r.replaceState).toHaveBeenCalledWith('/bookings/b-1/pay');
    expect(r.el.textContent).toContain('payment.confirming');
    r.http
      .expectOne({ url: URL, method: 'GET' })
      .flush(view({ status: 'SUCCEEDED' }));
    await r.settle();
    expect(r.navigate).toHaveBeenCalledWith(['/bookings', 'b-1'], {
      replaceUrl: true,
    });
    expect(fake.stripe.elements).not.toHaveBeenCalled();
  });

  it('says payments are unavailable without a Stripe key, and starts nothing', async () => {
    const r = await render({ stripe: null });
    r.http.expectOne({ url: URL, method: 'GET' }).flush(view());
    await r.settle();
    expect(r.el.textContent).toContain('payment.unavailable');
    expect(r.el.querySelector('.summary')).not.toBeNull();
    r.http.expectNone({ url: URL, method: 'POST' });
  });

  it('points to the booking when it is too late to pay', async () => {
    const r = await render();
    r.http.expectOne({ url: URL, method: 'GET' }).flush(view());
    await r.settle();
    r.http
      .expectOne({ url: URL, method: 'POST' })
      .flush(
        { statusCode: 409, code: 'PAYMENT_WINDOW_CLOSED', message: '' },
        { status: 409, statusText: 'Conflict' },
      );
    await r.settle();
    expect(r.el.querySelector('[role=alert]')?.textContent).toContain(
      'payment.errors.PAYMENT_WINDOW_CLOSED',
    );
    expect(r.el.textContent).toContain('payment.toBooking');
  });

  it('offers to try again when Stripe is not answering', async () => {
    const r = await render();
    r.http.expectOne({ url: URL, method: 'GET' }).flush(view());
    await r.settle();
    r.http
      .expectOne({ url: URL, method: 'POST' })
      .flush(
        { statusCode: 503, code: 'PROVIDER_UNAVAILABLE', message: '' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await r.settle();
    expect(r.el.textContent).toContain('payment.errors.PROVIDER_UNAVAILABLE');
    expect(r.el.textContent).toContain('payment.retry');
  });
});
