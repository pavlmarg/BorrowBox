import type { EmailKind, Locale } from '@borrowbox/contracts';
import {
  renderEmail,
  type EmailContent,
  type RenderedEmail,
} from '@borrowbox/mailer';
import type { EmailData } from './plan';

/**
 * Notifications' emails (ADR-0016), in Greek and English. Times are shown in
 * Europe/Athens, amounts in EUR. Names come from Notifications' recipients;
 * a person without one (unknown or erased) is "someone".
 */

export interface TemplateInput {
  kind: EmailKind;
  data: EmailData;
  locale: Locale;
  recipientName: string;
  /** The other person's name, or null if unknown or erased. */
  otherName: string | null;
  /** The PWA's origin, e.g. `https://borrowbox.gr`. */
  webBaseUrl: string;
}

const TIME_ZONE = 'Europe/Athens';

function when(iso: string | undefined, locale: Locale): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function euros(cents: number | undefined, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'el' ? 'el-GR' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format((cents ?? 0) / 100);
}

/** What the renter pays for a booking: rent + deposit + fee (ADR-0020). */
function chargeOf(data: EmailData, locale: Locale): string {
  return euros(
    (data.rentCents ?? 0) + (data.depositCents ?? 0) + (data.feeCents ?? 0),
    locale,
  );
}

export function renderNotification(input: TemplateInput): RenderedEmail {
  return renderEmail(input.locale === 'el' ? greek(input) : english(input));
}

function english(input: TemplateInput): EmailContent {
  const { data } = input;
  const other = input.otherName ?? 'Someone';
  const item = `“${data.itemTitle}”`;
  const period = `${when(data.start, 'en')} – ${when(data.end, 'en')}`;
  const rent = euros(data.rentCents, 'en');
  const deposit = euros(data.depositCents, 'en');
  const charge = (locale: Locale) => chargeOf(data, locale);
  const booking = {
    label: 'See the booking',
    url: `${input.webBaseUrl}/bookings/${data.bookingId}`,
  };
  const chat = {
    label: 'Open the chat',
    url: `${input.webBaseUrl}/messages/${data.conversationId}`,
  };
  const base = {
    greeting: `Hi ${input.recipientName},`,
    footer: 'You got this email about your bookings and messages on BorrowBox.',
  };

  switch (input.kind) {
    case 'BOOKING_REQUESTED':
      return {
        ...base,
        subject: `New request for ${item}`,
        paragraphs: [
          `${other} would like to borrow ${item}: ${period}, rent ${rent}.`,
          'Accept or decline within 24 hours, or the request expires.',
        ],
        action: { ...booking, label: 'See the request' },
      };
    case 'BOOKING_ACCEPTED':
      return {
        ...base,
        subject: `${other} accepted your request for ${item}`,
        paragraphs: [
          `${period}, rent ${rent}, deposit ${deposit}, service fee ${euros(data.feeCents, 'en')}.`,
          data.payBy
            ? `Pay ${charge('en')} in BorrowBox by ${when(data.payBy, 'en')} to keep the booking; otherwise it expires. The deposit comes back after the return.`
            : `Pay ${charge('en')} in BorrowBox within 24 hours to keep the booking; otherwise it expires.`,
        ],
        action: { ...booking, label: 'Pay now' },
      };
    case 'BOOKING_CONFIRMED':
      return {
        ...base,
        subject: `Your booking of ${item} is confirmed`,
        paragraphs: [
          `${period}.`,
          `Arrange where and when to meet with ${other} in the booking's chat.`,
        ],
        action: booking,
      };
    case 'BOOKING_PAID':
      return {
        ...base,
        subject: `The booking of ${item} is paid`,
        paragraphs: [
          `${period}.`,
          `Arrange where and when to meet with ${other} in the booking's chat.`,
        ],
        action: booking,
      };
    case 'PAYMENT_FAILED':
      return {
        ...base,
        subject: `Your payment for ${item} didn't go through`,
        paragraphs: [
          `Your bank didn't accept the payment of ${euros(data.chargeCents, 'en')}.`,
          `Try again by ${when(data.payBy, 'en')}, or the booking expires.`,
        ],
        action: { ...booking, label: 'Pay again' },
      };
    case 'BOOKING_DECLINED':
      return {
        ...base,
        subject: `Your request for ${item} was declined`,
        paragraphs: [
          data.reason === 'OVERLAP'
            ? `${item} was booked by someone else for ${period}.`
            : `${other} can't lend ${item} for ${period}.`,
          'You can look for another time or a similar item nearby.',
        ],
      };
    case 'BOOKING_EXPIRED':
      return {
        ...base,
        // NO_ANSWER: an unanswered request; otherwise a booking.
        subject:
          data.reason === 'NO_ANSWER'
            ? `The request for ${item} expired`
            : `The booking of ${item} expired`,
        paragraphs: [
          data.reason === 'PAYMENT_TIMEOUT'
            ? `The booking of ${item} for ${period} wasn't paid in time, so it expired.`
            : data.reason === 'STARTED'
              ? `The booking of ${item} for ${period} wasn't completed before it started.`
              : `The request for ${item} (${period}) wasn't answered in time.`,
        ],
        action: booking,
      };
    case 'BOOKING_CANCELLED':
      return {
        ...base,
        subject: `The booking of ${item} was cancelled`,
        paragraphs: [
          data.reason === 'ITEM_DELETED'
            ? `${item} was removed, so the booking for ${period} is cancelled.`
            : data.reason === 'ACCOUNT_DELETED'
              ? `The booking of ${item} for ${period} is cancelled because an account was closed.`
              : `${other} cancelled the booking of ${item} for ${period}.`,
        ],
        action: booking,
      };
    case 'OFFER_RECEIVED':
      return {
        ...base,
        subject: `${other} sent you an offer for ${item}`,
        paragraphs: [
          `${rent} for ${period}, plus a ${deposit} deposit.`,
          `The offer is valid until ${when(data.expiresAt, 'en')}.`,
        ],
        action: { ...chat, label: 'See the offer' },
      };
    case 'OFFER_BOOKED':
      return {
        ...base,
        subject: `${other} booked your offer for ${item}`,
        paragraphs: [`${period}, rent ${rent}.`],
        action: booking,
      };
    case 'MESSAGES_UNREAD':
      return {
        ...base,
        subject: `New messages about ${item}`,
        paragraphs: [
          data.unreadCount === 1
            ? `${other} sent you a message.`
            : `${other} sent you ${data.unreadCount} messages.`,
        ],
        action: { ...chat, label: 'Read them' },
      };
  }
}

function greek(input: TemplateInput): EmailContent {
  const { data } = input;
  const other = input.otherName ?? 'Κάποιος χρήστης';
  const item = `«${data.itemTitle}»`;
  const period = `${when(data.start, 'el')} – ${when(data.end, 'el')}`;
  const rent = euros(data.rentCents, 'el');
  const deposit = euros(data.depositCents, 'el');
  const charge = (locale: Locale) => chargeOf(data, locale);
  const booking = {
    label: 'Δες την κράτηση',
    url: `${input.webBaseUrl}/bookings/${data.bookingId}`,
  };
  const chat = {
    label: 'Άνοιξε τη συνομιλία',
    url: `${input.webBaseUrl}/messages/${data.conversationId}`,
  };
  const base = {
    greeting: `Γεια σου ${input.recipientName},`,
    footer:
      'Λαμβάνεις αυτό το email για τις κρατήσεις και τα μηνύματά σου στο BorrowBox.',
  };

  switch (input.kind) {
    case 'BOOKING_REQUESTED':
      return {
        ...base,
        subject: `Νέο αίτημα για ${item}`,
        paragraphs: [
          `${other} θέλει να δανειστεί ${item}: ${period}, ενοίκιο ${rent}.`,
          'Αποδέξου ή απόρριψε το αίτημα μέσα σε 24 ώρες, αλλιώς λήγει.',
        ],
        action: { ...booking, label: 'Δες το αίτημα' },
      };
    case 'BOOKING_ACCEPTED':
      return {
        ...base,
        subject: `${other} αποδέχτηκε το αίτημά σου για ${item}`,
        paragraphs: [
          `${period}, ενοίκιο ${rent}, εγγύηση ${deposit}, χρέωση υπηρεσίας ${euros(data.feeCents, 'el')}.`,
          data.payBy
            ? `Πλήρωσε ${charge('el')} στο BorrowBox έως ${when(data.payBy, 'el')} για να ισχύσει η κράτηση· αλλιώς λήγει. Η εγγύηση επιστρέφεται μετά την επιστροφή.`
            : `Πλήρωσε ${charge('el')} στο BorrowBox μέσα σε 24 ώρες για να ισχύσει η κράτηση· αλλιώς λήγει.`,
        ],
        action: { ...booking, label: 'Πλήρωσε τώρα' },
      };
    case 'BOOKING_CONFIRMED':
      return {
        ...base,
        subject: `Η κράτηση για ${item} επιβεβαιώθηκε`,
        paragraphs: [
          `${period}.`,
          `Κανόνισε με ${other} πού και πότε θα συναντηθείτε, στη συνομιλία της κράτησης.`,
        ],
        action: booking,
      };
    case 'BOOKING_PAID':
      return {
        ...base,
        subject: `Η κράτηση για ${item} πληρώθηκε`,
        paragraphs: [
          `${period}.`,
          `Κανόνισε με ${other} πού και πότε θα συναντηθείτε, στη συνομιλία της κράτησης.`,
        ],
        action: booking,
      };
    case 'PAYMENT_FAILED':
      return {
        ...base,
        subject: `Η πληρωμή σου για ${item} δεν ολοκληρώθηκε`,
        paragraphs: [
          `Η τράπεζά σου δεν δέχτηκε την πληρωμή των ${euros(data.chargeCents, 'el')}.`,
          `Δοκίμασε ξανά έως ${when(data.payBy, 'el')}, αλλιώς η κράτηση λήγει.`,
        ],
        action: { ...booking, label: 'Πλήρωσε ξανά' },
      };
    case 'BOOKING_DECLINED':
      return {
        ...base,
        subject: `Το αίτημά σου για ${item} απορρίφθηκε`,
        paragraphs: [
          data.reason === 'OVERLAP'
            ? `${item} κρατήθηκε από άλλον για ${period}.`
            : `${other} δεν μπορεί να δανείσει ${item} για ${period}.`,
          'Μπορείς να δοκιμάσεις άλλη ώρα ή κάτι παρόμοιο κοντά σου.',
        ],
      };
    case 'BOOKING_EXPIRED':
      return {
        ...base,
        subject:
          data.reason === 'NO_ANSWER'
            ? `Το αίτημα για ${item} έληξε`
            : `Η κράτηση για ${item} έληξε`,
        paragraphs: [
          data.reason === 'PAYMENT_TIMEOUT'
            ? `Η κράτηση για ${item} (${period}) δεν πληρώθηκε εγκαίρως, οπότε έληξε.`
            : data.reason === 'STARTED'
              ? `Η κράτηση για ${item} (${period}) δεν ολοκληρώθηκε πριν από την έναρξή της.`
              : `Το αίτημα για ${item} (${period}) δεν απαντήθηκε εγκαίρως.`,
        ],
        action: booking,
      };
    case 'BOOKING_CANCELLED':
      return {
        ...base,
        subject: `Η κράτηση για ${item} ακυρώθηκε`,
        paragraphs: [
          data.reason === 'ITEM_DELETED'
            ? `${item} αφαιρέθηκε, οπότε η κράτηση για ${period} ακυρώθηκε.`
            : data.reason === 'ACCOUNT_DELETED'
              ? `Η κράτηση για ${item} (${period}) ακυρώθηκε επειδή έκλεισε ένας λογαριασμός.`
              : `${other} ακύρωσε την κράτηση για ${item} (${period}).`,
        ],
        action: booking,
      };
    case 'OFFER_RECEIVED':
      return {
        ...base,
        subject: `${other} σου έστειλε προσφορά για ${item}`,
        paragraphs: [
          `${rent} για ${period}, συν εγγύηση ${deposit}.`,
          `Η προσφορά ισχύει έως ${when(data.expiresAt, 'el')}.`,
        ],
        action: { ...chat, label: 'Δες την προσφορά' },
      };
    case 'OFFER_BOOKED':
      return {
        ...base,
        subject: `${other} έκλεισε την προσφορά σου για ${item}`,
        paragraphs: [`${period}, ενοίκιο ${rent}.`],
        action: booking,
      };
    case 'MESSAGES_UNREAD':
      return {
        ...base,
        subject: `Νέα μηνύματα για ${item}`,
        paragraphs: [
          data.unreadCount === 1
            ? `${other} σου έστειλε ένα μήνυμα.`
            : `${other} σου έστειλε ${data.unreadCount} μηνύματα.`,
        ],
        action: { ...chat, label: 'Διάβασέ τα' },
      };
  }
}
