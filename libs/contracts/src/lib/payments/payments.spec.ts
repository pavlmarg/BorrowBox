import { PaymentAccountReadyV1, PaymentAccountRestrictedV1 } from './events';
import { stripeCallTimeoutMs, stripeRetrySleepMs } from './payments';
import { PAYMENTS_STRIPE_REQUESTS, PaymentsRpc } from './rpc';

describe('payments contracts', () => {
  it('have versioned routing keys', () => {
    expect(
      [PaymentAccountReadyV1, PaymentAccountRestrictedV1].map(
        (e) => e.routingKey,
      ),
    ).toEqual(['payment.account_ready.v1', 'payment.account_restricted.v1']);
  });

  it('keeps RPC patterns unique', () => {
    const patterns = Object.values(PaymentsRpc);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('waits longer than every Stripe request a call may make', () => {
    // 2 requests × (2 attempts × 10 s + 0.5 s before the retry), plus 5 s
    // for Payments itself.
    expect(
      stripeCallTimeoutMs(
        PAYMENTS_STRIPE_REQUESTS[PaymentsRpc.startOnboarding] ?? 0,
      ),
    ).toBe(46_000);
    expect(
      stripeCallTimeoutMs(
        PAYMENTS_STRIPE_REQUESTS[PaymentsRpc.dashboardLink] ?? 0,
      ),
    ).toBe(25_500);
  });

  it("follows the SDK's sleeps between retries: 0.5 s, doubling, at most 5 s", () => {
    expect(stripeRetrySleepMs(1)).toBe(0);
    expect(stripeRetrySleepMs(2)).toBe(500);
    expect(stripeRetrySleepMs(4)).toBe(500 + 1_000 + 2_000);
    expect(stripeRetrySleepMs(6)).toBe(500 + 1_000 + 2_000 + 4_000 + 5_000);
  });
});
