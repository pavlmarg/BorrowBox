import type { AccountFlags } from '../stripe/stripe-api';
import { payoutStatus, readinessChange } from './payout-status';

const flags = (over: Partial<AccountFlags> = {}): AccountFlags => ({
  detailsSubmitted: false,
  transfersActive: false,
  payoutsEnabled: false,
  disabled: false,
  ...over,
});

describe('payoutStatus', () => {
  it('is NOT_STARTED without an account', () => {
    expect(payoutStatus(null)).toBe('NOT_STARTED');
  });

  it('is INCOMPLETE until the lender has sent their details', () => {
    expect(payoutStatus(flags())).toBe('INCOMPLETE');
  });

  it('is PENDING while Stripe checks the details', () => {
    expect(payoutStatus(flags({ detailsSubmitted: true }))).toBe('PENDING');
  });

  it('is READY once transfers are active, whatever else is due', () => {
    expect(
      payoutStatus(flags({ detailsSubmitted: true, transfersActive: true })),
    ).toBe('READY');
    expect(payoutStatus(flags({ transfersActive: true }))).toBe('READY');
  });

  it('is RESTRICTED when Stripe disabled the account', () => {
    expect(
      payoutStatus(flags({ detailsSubmitted: true, disabled: true })),
    ).toBe('RESTRICTED');
    expect(payoutStatus(flags({ disabled: true }))).toBe('RESTRICTED');
  });
});

describe('readinessChange', () => {
  it('announces becoming ready and losing it, nothing else', () => {
    expect(readinessChange(false, true)).toBe('READY');
    expect(readinessChange(true, false)).toBe('RESTRICTED');
    expect(readinessChange(true, true)).toBeNull();
    expect(readinessChange(false, false)).toBeNull();
  });
});
