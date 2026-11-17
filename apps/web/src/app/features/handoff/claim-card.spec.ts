import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import type { BookingViewResponse, ClaimResponse } from '../../api/models';
import { tick } from '../../../testing/auth';
import { booking } from '../../../testing/bookings';
import { ClaimCard, amountProblem } from './claim-card';
import { ClaimStore } from './claim.store';
import { ConditionPhotosStore } from './condition-photos.store';

const H = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * H).toISOString();

const returned = (role: 'RENTER' | 'LENDER') =>
  booking({
    role,
    status: 'RETURNED',
    expiresAt: null,
    handoff: {
      ...booking().handoff,
      pickedUpAt: inHours(-30),
      returnedAt: inHours(-2),
      claimUntil: inHours(46),
    },
  });

const claim = (over: Partial<ClaimResponse> = {}): ClaimResponse => ({
  bookingId: 'b-1',
  amountCents: 3000,
  description: 'Scratched lens on the front',
  photoIds: [],
  status: 'OPEN',
  reply: null,
  awardCents: null,
  filedAt: inHours(-1),
  answeredAt: null,
  resolvedAt: null,
  ...over,
});

async function render(shown: BookingViewResponse, existing?: ClaimResponse) {
  const opened: Array<{ title: string; message: string }> = [];
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      ClaimStore,
      ConditionPhotosStore,
      {
        provide: MatDialog,
        useValue: {
          open: (
            _: unknown,
            config: { data: { title: string; message: string } },
          ) => {
            opened.push(config.data);
            return { afterClosed: () => of(true) };
          },
        },
      },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  if (existing) {
    const loading = TestBed.inject(ClaimStore).load('b-1');
    http.expectOne('/api/bookings/b-1/claim').flush({ claim: existing });
    await loading;
  }
  const fixture = TestBed.createComponent(ClaimCard);
  fixture.componentRef.setInput('booking', shown);
  fixture.componentRef.setInput('now', Date.now());
  let changed = 0;
  fixture.componentInstance.changed.subscribe(() => changed++);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await tick();
    await fixture.whenStable();
  };
  const button = (key: string) =>
    [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === key,
    ) as HTMLButtonElement | undefined;
  const type = async (selector: string, value: string) => {
    const field = el.querySelector<HTMLInputElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await settle();
  };
  return { el, http, settle, button, type, opened, changed: () => changed };
}

describe('amountProblem', () => {
  it('checks the typed amount against €1 and the deposit', () => {
    expect(amountProblem('abc', 5000)).toBe('invalid');
    expect(amountProblem('0,99', 5000)).toBe('tooLow');
    expect(amountProblem('50,01', 5000)).toBe('tooHigh');
    expect(amountProblem('50', 5000)).toBeNull();
    expect(amountProblem('1', 5000)).toBeNull();
  });
});

describe('ClaimCard', () => {
  it('stays hidden for the renter while there is no claim', async () => {
    const { el } = await render(returned('RENTER'));
    expect(el.textContent?.trim()).toBe('');
  });

  it('lets the lender report damage, sending the amount in cents', async () => {
    const { el, http, settle, button, type, opened, changed } = await render(
      returned('LENDER'),
    );
    expect(el.textContent).toContain('claims.canFile');
    button('claims.report')?.click();
    await settle();

    await type('#claim-amount', '30,50');
    await type('#claim-description', '  Scratched lens on the front  ');
    button('claims.submit')?.click();
    await settle();

    expect(opened[0].title).toBe('claims.confirm.file.title');
    const req = http.expectOne('/api/bookings/b-1/claim');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      amountCents: 3050,
      description: 'Scratched lens on the front',
    });
    req.flush(claim({ amountCents: 3050 }));
    await settle();
    expect(changed()).toBe(1);
    expect(el.textContent).toContain('claims.status.OPEN.LENDER');
  });

  it('sends nothing while the amount or description is wrong', async () => {
    const { el, http, settle, button, type } = await render(returned('LENDER'));
    button('claims.report')?.click();
    await settle();
    await type('#claim-amount', '80');
    await type('#claim-description', 'Broken');
    button('claims.submit')?.click();
    await settle();

    expect(el.textContent).toContain('claims.amount.tooHigh');
    expect(el.textContent).toContain('claims.text.TOO_SHORT');
    http.expectNone('/api/bookings/b-1/claim');
  });

  it('warns about contact details as they are typed', async () => {
    const { el, settle, button, type } = await render(returned('LENDER'));
    button('claims.report')?.click();
    await settle();
    await type('#claim-description', 'Call me on 6912345678 about it');
    expect(el.textContent).toContain('claims.text.CONTACT_DETAILS');
  });

  it('lets the renter agree, with a confirmation naming the amounts', async () => {
    const { http, settle, button, opened, changed } = await render(
      booking({ ...returned('RENTER'), status: 'DISPUTED' }),
      claim(),
    );
    button('claims.agree')?.click();
    await settle();

    expect(opened[0].title).toBe('claims.confirm.agree.title');
    const req = http.expectOne('/api/bookings/b-1/claim/answer');
    expect(req.request.body).toEqual({ answer: 'AGREE' });
    req.flush(claim({ status: 'AGREED', awardCents: 3000 }));
    await settle();
    expect(changed()).toBe(1);
  });

  it('lets the lender withdraw a disagreed claim', async () => {
    const { http, settle, button } = await render(
      booking({ ...returned('LENDER'), status: 'DISPUTED' }),
      claim({ status: 'DISAGREED', reply: 'It was already scratched' }),
    );
    button('claims.withdraw')?.click();
    await settle();
    const req = http.expectOne('/api/bookings/b-1/claim/withdraw');
    expect(req.request.method).toBe('POST');
  });

  it('shows where the deposit went once resolved', async () => {
    const { el, button } = await render(
      booking({ ...returned('RENTER'), status: 'COMPLETED' }),
      claim({ status: 'AGREED', awardCents: 3000 }),
    );
    expect(el.textContent).toContain('claims.status.AGREED');
    expect(el.textContent).toContain('claims.outcome');
    expect(button('claims.agree')).toBeUndefined();
    expect(button('claims.withdraw')).toBeUndefined();
  });
});
