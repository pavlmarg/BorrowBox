import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { tick } from '../../../testing/auth';
import { ITEM_ID } from '../../../testing/chat';
import { OfferDialog, type OfferDialogData } from './offer.dialog';
import type { Period } from './period-picker';

const period: Period = {
  start: '2026-11-20T08:00:00.000Z',
  end: '2026-11-21T08:00:00.000Z',
};

async function render(
  sendResult: Awaited<ReturnType<OfferDialogData['send']>>,
) {
  const data: OfferDialogData = {
    itemId: ITEM_ID,
    hasOpenOffer: true,
    send: jest.fn(async () => sendResult),
  };
  const ref = { close: jest.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: ref },
    ],
  });
  const fixture = TestBed.createComponent(OfferDialog);
  await fixture.whenStable();
  const dialog = fixture.componentInstance as unknown as {
    setPeriod(p: Period | null): Promise<void>;
    rent: { setValue(v: number): void; value: number | null };
  };
  const http = TestBed.inject(HttpTestingController);
  const choose = async () => {
    const quoting = dialog.setPeriod(period);
    http
      .expectOne((r) => r.url === `/api/items/${ITEM_ID}/quote`)
      .flush({
        itemId: ITEM_ID,
        ...period,
        rentCents: 2000,
        depositCents: 5000,
        feeCents: 200,
        lenderFeeCents: 50,
        payoutCents: 1950,
        totalCents: 7200,
        units: {},
      });
    await quoting;
    await fixture.whenStable();
  };
  const el = fixture.nativeElement as HTMLElement;
  const sendButton = () =>
    [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'offers.send',
    ) as HTMLButtonElement;
  return { fixture, dialog, data, ref, el, choose, sendButton };
}

describe('OfferDialog', () => {
  it('starts from the list price and refuses more than it', async () => {
    const { dialog, choose, sendButton, data, fixture, el } =
      await render(null);
    expect(sendButton().disabled).toBe(true);
    await choose();
    expect(dialog.rent.value).toBe(2000);
    expect(el.textContent).toContain('offers.replaces');

    dialog.rent.setValue(2500);
    sendButton().click();
    await fixture.whenStable();
    expect(data.send).not.toHaveBeenCalled();
    expect(el.textContent).toContain('offers.rentTooHigh');
  });

  it('sends the offer and closes', async () => {
    const { dialog, choose, sendButton, data, ref } = await render(null);
    await choose();
    dialog.rent.setValue(1500);
    sendButton().click();
    await tick();
    expect(data.send).toHaveBeenCalledWith(period.start, period.end, 1500);
    expect(ref.close).toHaveBeenCalledWith(true);
  });

  it('links to payouts when they are not set up', async () => {
    const { choose, sendButton, fixture, el, ref } = await render({
      code: 'PAYOUTS_NOT_SET_UP',
      key: 'chat.errors.PAYOUTS_NOT_SET_UP',
    });
    await choose();
    sendButton().click();
    await tick();
    await fixture.whenStable();
    expect(ref.close).not.toHaveBeenCalled();
    expect(el.textContent).toContain('chat.errors.PAYOUTS_NOT_SET_UP');
    expect(el.querySelector('a[href="/settings/payouts"]')).not.toBeNull();
  });
});
