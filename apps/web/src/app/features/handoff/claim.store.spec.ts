import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Api } from '../../api/api';
import {
  bookingsControllerAnswerClaim,
  bookingsControllerClaim,
  bookingsControllerFileClaim,
  bookingsControllerWithdrawClaim,
} from '../../api/functions';
import type { ClaimResponse } from '../../api/models';
import { ClaimStore } from './claim.store';

const BOOKING = 'b1';
const claim = (over: Partial<ClaimResponse> = {}): ClaimResponse => ({
  bookingId: BOOKING,
  amountCents: 3000,
  description: 'Scratched lens',
  photoIds: [],
  status: 'OPEN',
  reply: null,
  awardCents: null,
  filedAt: '2026-12-03T10:00:00.000Z',
  answeredAt: null,
  resolvedAt: null,
  ...over,
});

function setup(invoke: jest.Mock) {
  TestBed.configureTestingModule({
    providers: [ClaimStore, { provide: Api, useValue: { invoke } }],
  });
  return TestBed.inject(ClaimStore);
}

describe('ClaimStore', () => {
  it('loads no claim as null', async () => {
    const invoke = jest.fn().mockResolvedValue({ claim: null });
    const store = setup(invoke);

    await store.load(BOOKING);

    expect(invoke).toHaveBeenCalledWith(bookingsControllerClaim, {
      bookingId: BOOKING,
    });
    expect(store.claim()).toBeNull();
    expect(store.status()).toBe('ready');
  });

  it('files a claim and shows the saved one', async () => {
    const invoke = jest.fn().mockResolvedValue(claim());
    const store = setup(invoke);
    const body = { amountCents: 3000, description: 'Scratched lens' };

    expect(await store.file(BOOKING, body)).toBeNull();

    expect(invoke).toHaveBeenCalledWith(bookingsControllerFileClaim, {
      bookingId: BOOKING,
      body,
    });
    expect(store.claim()?.status).toBe('OPEN');
    expect(store.acting()).toBeNull();
  });

  it('answers and withdraws through their own calls', async () => {
    const invoke = jest
      .fn()
      .mockResolvedValueOnce(claim({ status: 'DISAGREED' }))
      .mockResolvedValueOnce(claim({ status: 'WITHDRAWN', awardCents: 0 }));
    const store = setup(invoke);

    await store.answer(BOOKING, { answer: 'DISAGREE', reply: 'It was there' });
    expect(invoke).toHaveBeenLastCalledWith(bookingsControllerAnswerClaim, {
      bookingId: BOOKING,
      body: { answer: 'DISAGREE', reply: 'It was there' },
    });
    expect(store.claim()?.status).toBe('DISAGREED');

    await store.withdraw(BOOKING);
    expect(invoke).toHaveBeenLastCalledWith(bookingsControllerWithdrawClaim, {
      bookingId: BOOKING,
    });
    expect(store.claim()?.awardCents).toBe(0);
  });

  it('reloads after a refusal because the claim changed meanwhile', async () => {
    const invoke = jest
      .fn()
      .mockRejectedValueOnce(
        new HttpErrorResponse({ status: 409, error: { code: 'CLAIM_EXISTS' } }),
      )
      .mockResolvedValueOnce({ claim: claim() });
    const store = setup(invoke);

    const code = await store.file(BOOKING, {
      amountCents: 100,
      description: 'Broken handle',
    });

    expect(code).toBe('CLAIM_EXISTS');
    expect(invoke).toHaveBeenLastCalledWith(bookingsControllerClaim, {
      bookingId: BOOKING,
    });
    expect(store.claim()?.amountCents).toBe(3000);
  });
});
