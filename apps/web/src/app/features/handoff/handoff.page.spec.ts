import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import type { BookingViewResponse } from '../../api/models';
import { tick } from '../../../testing/auth';
import { booking } from '../../../testing/bookings';
import { HandoffPage } from './handoff.page';

jest.mock('qrcode', () => ({
  toCanvas: jest.fn().mockResolvedValue(undefined),
}));

const H = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * H).toISOString();

const paid = (
  role: 'RENTER' | 'LENDER',
  over: Partial<BookingViewResponse> = {},
) =>
  booking({
    role,
    status: 'PAID',
    start: inHours(1),
    end: inHours(25),
    expiresAt: null,
    handoff: { ...booking().handoff, pickupOpensAt: inHours(-1) },
    ...over,
  });

async function render(shown: BookingViewResponse, phase = 'PICKUP') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
    ],
  });
  const fixture = TestBed.createComponent(HandoffPage);
  fixture.componentRef.setInput('id', 'b-1');
  fixture.componentRef.setInput('phase', phase);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/bookings/b-1').flush(shown);
  await tick();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, http };
}

describe('HandoffPage', () => {
  it('gives the lender the code on white at pickup', async () => {
    const { el, fixture } = await render(paid('LENDER'));
    expect(el.querySelector('bb-handoff-show')).not.toBeNull();
    expect(el.querySelector('.screen.paper')).not.toBeNull();
    expect(el.textContent).toContain('handoff.title.PICKUP.SHOW');
    fixture.destroy();
  });

  it('gives the renter the scanner at pickup', async () => {
    const { el, fixture } = await render(paid('RENTER'));
    expect(el.querySelector('bb-handoff-scan')).not.toBeNull();
    expect(el.querySelector('.screen.paper')).toBeNull();
    fixture.destroy();
  });

  it('says it is done once the handoff happened', async () => {
    const { el, fixture } = await render(
      paid('LENDER', { status: 'PICKED_UP' }),
    );
    expect(el.textContent).toContain('handoff.done.PICKUP');
    expect(el.querySelector('bb-handoff-show')).toBeNull();
    fixture.destroy();
  });

  it('refuses an unknown phase or a closed handoff', async () => {
    const { el, fixture } = await render(paid('LENDER'), 'LUNCH');
    expect(el.textContent).toContain('handoff.notOpen');
    fixture.destroy();
  });

  it('says when the pickup opens before it does', async () => {
    const { el, fixture } = await render(
      paid('LENDER', {
        start: inHours(30),
        handoff: { ...booking().handoff, pickupOpensAt: inHours(28) },
      }),
    );
    expect(el.textContent).toContain('handoff.opensAt');
    expect(el.querySelector('bb-handoff-show')).toBeNull();
    fixture.destroy();
  });
});
