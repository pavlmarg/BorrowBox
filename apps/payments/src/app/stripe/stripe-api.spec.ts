import Stripe from 'stripe';
import {
  StripeObjectMissingError,
  StripeRequestError,
  StripeUnavailableError,
  toStripeCallError,
} from './stripe-api';

/** Stripe's messages can echo request data: this one carries an email address. */
const raw = {
  message: 'No such customer: maria@example.com',
  requestId: 'req_123',
};

describe('toStripeCallError', () => {
  it.each([
    [new Stripe.errors.StripeConnectionError(raw), StripeUnavailableError],
    [
      new Stripe.errors.StripeAPIError({ ...raw, statusCode: 500 }),
      StripeUnavailableError,
    ],
    [
      new Stripe.errors.StripeRateLimitError({ ...raw, statusCode: 429 }),
      StripeUnavailableError,
    ],
    [
      new Stripe.errors.StripeIdempotencyError({ ...raw, statusCode: 409 }),
      StripeUnavailableError,
    ],
    [
      new Stripe.errors.StripeAuthenticationError({ ...raw, statusCode: 401 }),
      StripeRequestError,
    ],
    [
      new Stripe.errors.StripePermissionError({ ...raw, statusCode: 403 }),
      StripeRequestError,
    ],
    [
      new Stripe.errors.StripeInvalidRequestError({
        ...raw,
        statusCode: 400,
        code: 'parameter_invalid_empty',
      }),
      StripeRequestError,
    ],
    [
      new Stripe.errors.StripeInvalidRequestError({
        ...raw,
        statusCode: 404,
        code: 'resource_missing',
      }),
      StripeObjectMissingError,
    ],
  ])('maps %s', (sdkError, expected) => {
    const mapped = toStripeCallError(sdkError);
    expect(mapped).toBeInstanceOf(expected);
    const err = mapped as Error;
    expect(err.name).toBe(expected.name);
    // What identifies the failure, never Stripe's message.
    expect(err.message).toContain(sdkError.type);
    expect(err.message).toContain('request=req_123');
    expect(err.message).not.toContain('maria');
  });

  it('keeps the code and the HTTP status', () => {
    const err = toStripeCallError(
      new Stripe.errors.StripeInvalidRequestError({
        ...raw,
        statusCode: 400,
        code: 'parameter_invalid_empty',
      }),
    ) as StripeRequestError;
    expect(err.failure).toEqual({
      type: 'StripeInvalidRequestError',
      code: 'parameter_invalid_empty',
      statusCode: 400,
      requestId: 'req_123',
    });
    expect(err.message).toBe(
      'StripeInvalidRequestError code=parameter_invalid_empty status=400 request=req_123',
    );
  });

  it('leaves errors that are not from Stripe alone', () => {
    const other = new TypeError('boom');
    expect(toStripeCallError(other)).toBe(other);
  });
});
