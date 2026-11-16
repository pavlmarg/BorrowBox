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
    case 'REFUND_ISSUED':
      return {
        ...base,
        subject: `Your refund for ${item}`,
        paragraphs: [
          `${euros(data.amountCents, 'en')} is on its way back to your card.`,
          'Banks usually take 5 to 10 days to show it.',
        ],
        action: booking,
      };
    case 'DEPOSIT_RETURNED':
      return {
        ...base,
        subject: `Your deposit for ${item} is on its way back`,
        paragraphs: [
          `${euros(data.amountCents, 'en')} is on its way back to your card.`,
          'Banks usually take 5 to 10 days to show it. Thanks for borrowing on BorrowBox.',
        ],
        action: booking,
      };
    case 'PAYOUT_SENT':
      return {
        ...base,
        subject: `You've been paid for ${item}`,
        paragraphs: [
          `${euros(data.amountCents, 'en')} was sent to your Stripe account.`,
          'Stripe pays it out to your bank account on its usual schedule.',
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
            : data.reason === 'NO_HANDOFF'
              ? `Nobody confirmed that ${item} was picked up for ${period}, so the booking ended. If it was paid, the renter gets everything back.`
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
    case 'HANDOFF_QUESTION': {
      const pickup = data.phase === 'PICKUP';
      const question = pickup
        ? `Was ${item} picked up?`
        : `Was ${item} returned?`;
      return {
        ...base,
        subject: data.round === 3 ? `Last reminder: ${question}` : question,
        paragraphs: [
          pickup
            ? `The pickup of ${item} (${period}) wasn't scanned in BorrowBox. Did it happen? Answer on the booking page, or scan the pickup code if you're meeting now.`
            : `The return of ${item} (${period}) wasn't scanned in BorrowBox. Did it happen? Answer on the booking page, or scan the return code if you're meeting now.`,
          pickup
            ? `If nobody confirms it by ${when(data.decideAt, 'en')}, the booking ends and the renter gets everything back.`
            : `If the lender hasn't confirmed it by ${when(data.decideAt, 'en')}, our team will look into it.`,
        ],
        action: { ...booking, label: 'Answer' },
      };
    }
    case 'BOOKING_RETURNED':
      return {
        ...base,
        subject: `${item} was returned`,
        paragraphs: [
          data.claimUntil
            ? `The lender can report damage until ${when(data.claimUntil, 'en')}. After that, the booking completes and the deposit goes back.`
            : 'The booking is complete. Thanks for using BorrowBox.',
        ],
        action: booking,
      };
    case 'BOOKING_IN_REVIEW':
      return {
        ...base,
        subject: `We're looking into the booking of ${item}`,
        paragraphs: [
          data.reason === 'RETURN_UNCONFIRMED'
            ? `The return of ${item} (${period}) wasn't confirmed by both of you.`
            : `The pickup of ${item} (${period}) wasn't confirmed by both of you.`,
          'Our team will be in touch. Until then, no money moves. If you meet to hand the item back, scanning the return code settles it.',
        ],
        action: booking,
      };
    case 'CLAIM_FILED':
      return {
        ...base,
        subject: `${other} reported damage to ${item}`,
        paragraphs: [
          `${other} claims ${euros(data.amountCents, 'en')} from your ${deposit} deposit for damage.`,
          'See the claim and the photos, then agree or disagree. If you disagree, our team will decide. Until then your deposit stays where it is.',
        ],
        action: { ...booking, label: 'See the claim' },
      };
    case 'CLAIM_AGREED':
      return {
        ...base,
        subject: `${other} agreed to your claim for ${item}`,
        paragraphs: [
          `${euros(data.amountCents, 'en')} of the deposit goes to you with the rent. You'll get an email when it's sent.`,
        ],
        action: booking,
      };
    case 'CLAIM_DISAGREED':
      return {
        ...base,
        subject: `${other} disagrees with your claim for ${item}`,
        paragraphs: [
          `${other} doesn't agree to pay ${euros(data.amountCents, 'en')}. Our team will look at the claim and the photos and decide.`,
          'You can still withdraw the claim; the booking then completes as usual.',
        ],
        action: booking,
      };
    case 'CLAIM_WITHDRAWN':
      return {
        ...base,
        subject: `The damage claim for ${item} was withdrawn`,
        paragraphs: [
          `${other} withdrew the claim. Your whole deposit is on its way back; you'll get an email when it's sent.`,
        ],
        action: booking,
      };
    case 'CLAIM_DECIDED':
      return {
        ...base,
        subject: `The damage claim for ${item} was decided`,
        paragraphs: [
          `Our team decided that ${euros(data.amountCents, 'en')} of the ${deposit} deposit goes to the lender; the rest goes back to the renter.`,
        ],
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
    case 'REFUND_ISSUED':
      return {
        ...base,
        subject: `Η επιστροφή χρημάτων για ${item}`,
        paragraphs: [
          `${euros(data.amountCents, 'el')} επιστρέφονται στην κάρτα σου.`,
          'Οι τράπεζες συνήθως χρειάζονται 5 έως 10 ημέρες για να τα εμφανίσουν.',
        ],
        action: booking,
      };
    case 'DEPOSIT_RETURNED':
      return {
        ...base,
        subject: `Η εγγύηση για ${item} επιστρέφεται`,
        paragraphs: [
          `${euros(data.amountCents, 'el')} επιστρέφονται στην κάρτα σου.`,
          'Οι τράπεζες συνήθως χρειάζονται 5 έως 10 ημέρες. Ευχαριστούμε που δανείστηκες μέσω BorrowBox.',
        ],
        action: booking,
      };
    case 'PAYOUT_SENT':
      return {
        ...base,
        subject: `Πληρώθηκες για ${item}`,
        paragraphs: [
          `${euros(data.amountCents, 'el')} στάλθηκαν στον λογαριασμό σου στο Stripe.`,
          'Το Stripe τα μεταφέρει στον τραπεζικό σου λογαριασμό με το συνηθισμένο του πρόγραμμα.',
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
            : data.reason === 'NO_HANDOFF'
              ? `Κανείς δεν επιβεβαίωσε την παραλαβή για ${item} (${period}), οπότε η κράτηση έληξε. Αν είχε πληρωθεί, ο δανειζόμενος παίρνει πίσω όλα τα χρήματα.`
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
    case 'HANDOFF_QUESTION': {
      const pickup = data.phase === 'PICKUP';
      const question = pickup
        ? `Έγινε η παραλαβή για ${item};`
        : `Έγινε η επιστροφή για ${item};`;
      return {
        ...base,
        subject:
          data.round === 3 ? `Τελευταία υπενθύμιση: ${question}` : question,
        paragraphs: [
          pickup
            ? `Η παραλαβή για ${item} (${period}) δεν σαρώθηκε στο BorrowBox. Έγινε; Απάντησε στη σελίδα της κράτησης ή σάρωσε τον κωδικό παραλαβής, αν συναντιέστε τώρα.`
            : `Η επιστροφή για ${item} (${period}) δεν σαρώθηκε στο BorrowBox. Έγινε; Απάντησε στη σελίδα της κράτησης ή σάρωσε τον κωδικό επιστροφής, αν συναντιέστε τώρα.`,
          pickup
            ? `Αν δεν το επιβεβαιώσει κανείς έως ${when(data.decideAt, 'el')}, η κράτηση λήγει και ο δανειζόμενος παίρνει πίσω όλα τα χρήματα.`
            : `Αν ο δανειστής δεν το επιβεβαιώσει έως ${when(data.decideAt, 'el')}, η ομάδα μας θα το εξετάσει.`,
        ],
        action: { ...booking, label: 'Απάντησε' },
      };
    }
    case 'BOOKING_RETURNED':
      return {
        ...base,
        subject: `${item} επιστράφηκε`,
        paragraphs: [
          data.claimUntil
            ? `Ο δανειστής μπορεί να αναφέρει ζημιά έως ${when(data.claimUntil, 'el')}. Μετά, η κράτηση ολοκληρώνεται και η εγγύηση επιστρέφεται.`
            : 'Η κράτηση ολοκληρώθηκε. Ευχαριστούμε που χρησιμοποιείς το BorrowBox.',
        ],
        action: booking,
      };
    case 'BOOKING_IN_REVIEW':
      return {
        ...base,
        subject: `Εξετάζουμε την κράτηση για ${item}`,
        paragraphs: [
          data.reason === 'RETURN_UNCONFIRMED'
            ? `Η επιστροφή για ${item} (${period}) δεν επιβεβαιώθηκε και από τους δύο.`
            : `Η παραλαβή για ${item} (${period}) δεν επιβεβαιώθηκε και από τους δύο.`,
          'Η ομάδα μας θα επικοινωνήσει μαζί σας. Μέχρι τότε δεν μετακινούνται χρήματα. Αν συναντηθείτε για την επιστροφή, η σάρωση του κωδικού επιστροφής το διευθετεί.',
        ],
        action: booking,
      };
    case 'CLAIM_FILED':
      return {
        ...base,
        subject: `${other} ανέφερε ζημιά για ${item}`,
        paragraphs: [
          `${other} ζητά ${euros(data.amountCents, 'el')} από την εγγύηση των ${deposit} για ζημιά.`,
          'Δες το αίτημα και τις φωτογραφίες και απάντησε αν συμφωνείς ή όχι. Αν διαφωνείς, θα αποφασίσει η ομάδα μας. Μέχρι τότε η εγγύησή σου μένει ως έχει.',
        ],
        action: { ...booking, label: 'Δες το αίτημα' },
      };
    case 'CLAIM_AGREED':
      return {
        ...base,
        subject: `${other} συμφώνησε με το αίτημά σου για ${item}`,
        paragraphs: [
          `${euros(data.amountCents, 'el')} από την εγγύηση σού αποδίδονται μαζί με το ενοίκιο. Θα λάβεις email όταν σταλούν.`,
        ],
        action: booking,
      };
    case 'CLAIM_DISAGREED':
      return {
        ...base,
        subject: `${other} διαφωνεί με το αίτημά σου για ${item}`,
        paragraphs: [
          `${other} δεν δέχεται να πληρώσει ${euros(data.amountCents, 'el')}. Η ομάδα μας θα εξετάσει το αίτημα και τις φωτογραφίες και θα αποφασίσει.`,
          'Μπορείς ακόμη να αποσύρεις το αίτημα· τότε η κράτηση ολοκληρώνεται κανονικά.',
        ],
        action: booking,
      };
    case 'CLAIM_WITHDRAWN':
      return {
        ...base,
        subject: `Το αίτημα ζημιάς για ${item} αποσύρθηκε`,
        paragraphs: [
          `${other} απέσυρε το αίτημα. Όλη η εγγύησή σου επιστρέφεται· θα λάβεις email όταν σταλεί.`,
        ],
        action: booking,
      };
    case 'CLAIM_DECIDED':
      return {
        ...base,
        subject: `Αποφασίστηκε το αίτημα ζημιάς για ${item}`,
        paragraphs: [
          `Η ομάδα μας αποφάσισε ότι ${euros(data.amountCents, 'el')} από την εγγύηση των ${deposit} αποδίδονται στον δανειστή· τα υπόλοιπα επιστρέφονται στον δανειζόμενο.`,
        ],
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
