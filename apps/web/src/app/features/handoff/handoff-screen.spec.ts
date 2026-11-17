import type {
  BookingViewResponse,
  HandoffTokenResponse,
} from '../../api/models';
import {
  cleanCode,
  groupCode,
  handoffDone,
  isFullCode,
  nextTokenDelayMs,
  scanErrorIsFinal,
  scanErrorKey,
} from './handoff-screen';

const NOW = Date.parse('2026-12-01T10:00:00Z');
const token = (refreshAfterSeconds: number, expiresInS: number) =>
  ({
    token: 'v1.x.y',
    code: '482913',
    refreshAfterSeconds,
    expiresAt: new Date(NOW + expiresInS * 1000).toISOString(),
  }) as HandoffTokenResponse;

describe('nextTokenDelayMs', () => {
  it('follows the server while the code stays valid long enough', () => {
    expect(nextTokenDelayMs(token(30, 45), NOW)).toBe(30_000);
  });

  it('fetches early when the code would expire first (slow response)', () => {
    expect(nextTokenDelayMs(token(30, 25), NOW)).toBe(15_000);
  });

  it('never spins faster than once a second', () => {
    expect(nextTokenDelayMs(token(30, 5), NOW)).toBe(1_000);
  });
});

describe('handoffDone', () => {
  const b = (status: string) => ({ status }) as BookingViewResponse;
  it('sees the pickup done from PICKED_UP on', () => {
    expect(handoffDone(b('PAID'), 'PICKUP')).toBe(false);
    expect(handoffDone(b('PICKED_UP'), 'PICKUP')).toBe(true);
    expect(handoffDone(b('COMPLETED'), 'PICKUP')).toBe(true);
  });
  it('sees the return done from RETURNED on', () => {
    expect(handoffDone(b('PICKED_UP'), 'RETURN')).toBe(false);
    expect(handoffDone(b('RETURNED'), 'RETURN')).toBe(true);
    expect(handoffDone(b('DISPUTED'), 'RETURN')).toBe(true);
  });
});

describe('scan errors', () => {
  it('words a wrong typed code apart from a foreign QR', () => {
    expect(scanErrorKey('TOKEN_INVALID', 'CODE')).toBe(
      'handoff.errors.TOKEN_INVALID_CODE',
    );
    expect(scanErrorKey('TOKEN_INVALID', 'QR')).toBe(
      'handoff.errors.TOKEN_INVALID_QR',
    );
  });

  it('has handoff words for its own refusals, bookings words otherwise', () => {
    expect(scanErrorKey('RATE_LIMITED', 'CODE')).toBe(
      'handoff.errors.RATE_LIMITED',
    );
    expect(scanErrorKey('NOT_FOUND', 'QR')).toBe('bookings.errors.NOT_FOUND');
  });

  it('stops scanning only when retrying cannot help', () => {
    expect(scanErrorIsFinal('NOT_COUNTERPARTY')).toBe(true);
    expect(scanErrorIsFinal('TOKEN_EXPIRED')).toBe(false);
  });
});

describe('codes', () => {
  it('keeps digits only, at most 6', () => {
    expect(cleanCode('482 913')).toBe('482913');
    expect(cleanCode('48-29-13-77')).toBe('482913');
    expect(isFullCode('48291')).toBe(false);
    expect(isFullCode('482913')).toBe(true);
  });

  it('groups a code in threes', () => {
    expect(groupCode('482913')).toBe('482 913');
  });
});
