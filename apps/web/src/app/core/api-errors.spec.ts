import { HttpErrorResponse } from '@angular/common/http';
import { errorCode } from './api-errors';

const httpError = (status: number, error: unknown) =>
  new HttpErrorResponse({ status, error });

describe('errorCode', () => {
  it('reads the code from a parsed JSON body', () => {
    expect(errorCode(httpError(409, { code: 'EMAIL_TAKEN' }))).toBe(
      'EMAIL_TAKEN',
    );
  });

  it('reads the code from a text body (calls answering 204/202)', () => {
    expect(
      errorCode(
        httpError(
          400,
          JSON.stringify({
            statusCode: 400,
            code: 'TOKEN_EXPIRED',
            message: 'x',
          }),
        ),
      ),
    ).toBe('TOKEN_EXPIRED');
  });

  it('falls back when the body is not the gateway’s', () => {
    expect(errorCode(httpError(400, 'Bad Request'))).toBe('UNKNOWN');
    expect(errorCode(httpError(502, '<html>'))).toBe('INTERNAL');
    expect(errorCode(httpError(400, 'null'))).toBe('UNKNOWN');
    expect(errorCode(httpError(0, null))).toBe('NETWORK');
    expect(errorCode(new Error('boom'))).toBe('INTERNAL');
  });
});
