import type { BookingStatus } from '@borrowbox/contracts';
import { photosOpen } from './photo-window';

const at = (iso: string) => new Date(iso);
const start = at('2026-12-01T10:00:00Z');

function booking(
  status: BookingStatus,
  picked_up_at: Date | null = null,
  returned_at: Date | null = null,
) {
  return { status, start, picked_up_at, returned_at };
}

describe('photosOpen', () => {
  it('opens the pickup 2 hours before the start, while the booking goes ahead', () => {
    expect(
      photosOpen(booking('PAID'), 'PICKUP', at('2026-12-01T07:59:00Z')),
    ).toBe(false);
    expect(
      photosOpen(booking('PAID'), 'PICKUP', at('2026-12-01T08:00:00Z')),
    ).toBe(true);
    expect(
      photosOpen(booking('CONFIRMED'), 'PICKUP', at('2026-12-03T00:00:00Z')),
    ).toBe(true);
    // Not before it's paid, nor once it ended without a pickup.
    expect(
      photosOpen(booking('ACCEPTED'), 'PICKUP', at('2026-12-01T09:00:00Z')),
    ).toBe(false);
    expect(
      photosOpen(booking('EXPIRED'), 'PICKUP', at('2026-12-01T09:00:00Z')),
    ).toBe(false);
  });

  it('keeps the pickup open 2 hours after it was recorded', () => {
    const picked = at('2026-12-01T10:30:00Z');
    expect(
      photosOpen(
        booking('PICKED_UP', picked),
        'PICKUP',
        at('2026-12-01T12:29:00Z'),
      ),
    ).toBe(true);
    expect(
      photosOpen(
        booking('PICKED_UP', picked),
        'PICKUP',
        at('2026-12-01T12:30:00Z'),
      ),
    ).toBe(false);
  });

  it('opens the return while the item is out, 2 hours after it, and during a claim', () => {
    const picked = at('2026-12-01T10:30:00Z');
    const returned = at('2026-12-01T13:00:00Z');
    expect(
      photosOpen(booking('PAID'), 'RETURN', at('2026-12-01T09:00:00Z')),
    ).toBe(false);
    expect(
      photosOpen(
        booking('PICKED_UP', picked),
        'RETURN',
        at('2026-12-01T11:00:00Z'),
      ),
    ).toBe(true);
    expect(
      photosOpen(
        booking('RETURNED', picked, returned),
        'RETURN',
        at('2026-12-01T14:59:00Z'),
      ),
    ).toBe(true);
    expect(
      photosOpen(
        booking('RETURNED', picked, returned),
        'RETURN',
        at('2026-12-01T15:00:00Z'),
      ),
    ).toBe(false);
    expect(
      photosOpen(
        booking('DISPUTED', picked, returned),
        'RETURN',
        at('2026-12-05T00:00:00Z'),
      ),
    ).toBe(true);
  });
});
