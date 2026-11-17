import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Api } from '../../api/api';
import {
  bookingsControllerGet,
  bookingsControllerHandoffAnswer,
} from '../../api/functions';
import type { BookingViewResponse } from '../../api/models';
import { BookingStore } from './booking.store';

const asked = {
  id: 'b1',
  status: 'PAID',
  handoff: {
    question: {
      phase: 'PICKUP',
      myAnswer: null,
      otherAnswered: false,
      decideAt: '2026-12-04T10:00:00.000Z',
    },
  },
} as unknown as BookingViewResponse;

function setup(invoke: jest.Mock) {
  TestBed.configureTestingModule({
    providers: [BookingStore, { provide: Api, useValue: { invoke } }],
  });
  return TestBed.inject(BookingStore);
}

describe('BookingStore.answerHandoff', () => {
  it('answers the open question for its phase and shows the saved booking', async () => {
    const answered = { ...asked, status: 'PICKED_UP' };
    const invoke = jest
      .fn()
      .mockResolvedValueOnce(asked)
      .mockResolvedValueOnce(answered);
    const store = setup(invoke);
    await store.load('b1');

    expect(await store.answerHandoff('YES')).toBeNull();

    expect(invoke).toHaveBeenLastCalledWith(bookingsControllerHandoffAnswer, {
      bookingId: 'b1',
      body: { phase: 'PICKUP', answer: 'YES' },
    });
    expect(store.booking()?.status).toBe('PICKED_UP');
    expect(store.acting()).toBeNull();
  });

  it('does nothing without an open question', async () => {
    const invoke = jest
      .fn()
      .mockResolvedValueOnce({ ...asked, handoff: { question: null } });
    const store = setup(invoke);
    await store.load('b1');

    expect(await store.answerHandoff('NO')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reloads when the booking moved on meanwhile', async () => {
    const invoke = jest
      .fn()
      .mockResolvedValueOnce(asked)
      .mockRejectedValueOnce(
        new HttpErrorResponse({
          status: 409,
          error: { code: 'INVALID_STATE' },
        }),
      )
      .mockResolvedValueOnce({ ...asked, handoff: { question: null } });
    const store = setup(invoke);
    await store.load('b1');

    expect(await store.answerHandoff('YES')).toBe('INVALID_STATE');
    expect(invoke).toHaveBeenLastCalledWith(bookingsControllerGet, {
      bookingId: 'b1',
    });
    expect(store.booking()?.handoff.question).toBeNull();
  });
});
