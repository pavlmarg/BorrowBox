import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Api } from '../../api/api';
import { meControllerSendVerificationEmail } from '../../api/functions';
import { VerificationEmailStore } from './verification-email.store';

describe('VerificationEmailStore', () => {
  function setup(invoke: jest.Mock) {
    TestBed.configureTestingModule({
      providers: [
        VerificationEmailStore,
        { provide: Api, useValue: { invoke } },
      ],
    });
    return TestBed.inject(VerificationEmailStore);
  }

  it('reads as sent once Identity accepted the request', async () => {
    const invoke = jest.fn().mockResolvedValue(undefined);
    const store = setup(invoke);

    const sending = store.send();
    expect(store.status()).toBe('sending');
    // A second click while sending sends nothing more.
    await store.send();
    await sending;

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(meControllerSendVerificationEmail);
    expect(store.status()).toBe('sent');
    expect(store.error()).toBeNull();
  });

  it('shows the error and lets the user try again', async () => {
    const invoke = jest.fn().mockRejectedValue(
      new HttpErrorResponse({
        status: 429,
        error: JSON.stringify({ code: 'RATE_LIMITED' }),
      }),
    );
    const store = setup(invoke);

    await store.send();

    expect(store.status()).toBe('idle');
    expect(store.error()).toBe('RATE_LIMITED');
  });
});
