import { EMAIL_KINDS } from '@borrowbox/contracts';
import { renderNotification, type TemplateInput } from './templates';

const input = (overrides: Partial<TemplateInput> = {}): TemplateInput => ({
  kind: 'BOOKING_REQUESTED',
  data: {
    otherId: 'u-2',
    itemTitle: 'Drill <b>pro</b>',
    bookingId: 'b-1',
    conversationId: 'c-1',
    // Summer time in Athens: UTC+3.
    start: '2026-09-01T07:00:00.000Z',
    end: '2026-09-01T10:00:00.000Z',
    rentCents: 1250,
    depositCents: 5000,
    expiresAt: '2026-08-30T07:00:00.000Z',
    unreadCount: 3,
  },
  locale: 'en',
  recipientName: 'Lena',
  otherName: 'Rafael',
  webBaseUrl: 'https://borrowbox.test',
  ...overrides,
});

describe('renderNotification', () => {
  it.each(
    EMAIL_KINDS.flatMap(
      (kind) =>
        [
          [kind, 'el'],
          [kind, 'en'],
        ] as const,
    ),
  )('renders %s in %s with a subject, greeting and footer', (kind, locale) => {
    const email = renderNotification(input({ kind, locale }));
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.text).toContain(
      locale === 'el' ? 'Γεια σου Lena,' : 'Hi Lena,',
    );
    expect(email.html).toContain('BorrowBox');
  });

  it.each([
    ['NO_ANSWER', 'en', 'The request for “Drill <b>pro</b>” expired'],
    ['STARTED', 'en', 'The booking of “Drill <b>pro</b>” expired'],
    ['NO_ANSWER', 'el', 'Το αίτημα για «Drill <b>pro</b>» έληξε'],
    ['STARTED', 'el', 'Η κράτηση για «Drill <b>pro</b>» έληξε'],
    ['PAYMENT_TIMEOUT', 'en', 'The booking of “Drill <b>pro</b>” expired'],
    ['PAYMENT_TIMEOUT', 'el', 'Η κράτηση για «Drill <b>pro</b>» έληξε'],
  ] as const)(
    'names an expiry for %s a request or a booking (%s)',
    (reason, locale, subject) => {
      const email = renderNotification(
        input({
          kind: 'BOOKING_EXPIRED',
          locale,
          data: { ...input().data, reason },
        }),
      );
      expect(email.subject).toBe(subject);
    },
  );

  it('asks the renter to pay rent + deposit + fee by the pay-by time', () => {
    const data = {
      ...input().data,
      rentCents: 2000,
      depositCents: 5000,
      feeCents: 200,
      payBy: '2026-08-31T07:00:00.000Z',
    };
    const en = renderNotification(input({ kind: 'BOOKING_ACCEPTED', data }));
    expect(en.text).toContain('service fee €2.00');
    expect(en.text).toContain('Pay €72.00 in BorrowBox by');
    expect(en.text).toContain('10:00'); // Athens time
    const el = renderNotification(
      input({ kind: 'BOOKING_ACCEPTED', locale: 'el', data }),
    );
    expect(el.text).toContain('72,00');
  });

  it('says what failed and until when the renter can try again', () => {
    const email = renderNotification(
      input({
        kind: 'PAYMENT_FAILED',
        data: {
          ...input().data,
          chargeCents: 7200,
          payBy: '2026-08-31T07:00:00.000Z',
        },
      }),
    );
    expect(email.subject).toBe(
      "Your payment for “Drill <b>pro</b>” didn't go through",
    );
    expect(email.text).toContain('€72.00');
    expect(email.text).toContain('Try again by');
  });

  it('shows Athens time and EUR amounts', () => {
    const email = renderNotification(input());
    expect(email.text).toContain('10:00');
    expect(email.text).toContain('€12.50');
    const greek = renderNotification(input({ locale: 'el' }));
    expect(greek.text).toContain('12,50');
  });

  it('links to the booking or the conversation on the PWA', () => {
    expect(renderNotification(input()).text).toContain(
      'https://borrowbox.test/bookings/b-1',
    );
    expect(
      renderNotification(input({ kind: 'MESSAGES_UNREAD' })).text,
    ).toContain('https://borrowbox.test/messages/c-1');
  });

  it('escapes item titles in HTML', () => {
    const { html } = renderNotification(input());
    expect(html).not.toContain('<b>pro</b>');
    expect(html).toContain('&lt;b&gt;pro&lt;/b&gt;');
  });

  it('says "someone" for a person without a name', () => {
    expect(renderNotification(input({ otherName: null })).text).toContain(
      'Someone would like to borrow',
    );
  });
});
