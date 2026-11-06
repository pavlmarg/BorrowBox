import { PaymentAccountReadyV1, PaymentAccountRestrictedV1 } from './events';
import { stripeCallTimeoutMs } from './payments';
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
    // 2 requests × 2 attempts × 10 s, plus 5 s for Payments itself.
    expect(
      stripeCallTimeoutMs(
        PAYMENTS_STRIPE_REQUESTS[PaymentsRpc.startOnboarding] ?? 0,
      ),
    ).toBe(45_000);
  });
});
