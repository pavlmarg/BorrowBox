import type { Locale } from '@borrowbox/contracts';
import { renderEmail, type RenderedEmail } from '@borrowbox/mailer';

/** Identity's account-security emails (ADR-0016), in the account's language. */

export function verifyEmailMessage(
  locale: Locale,
  name: string,
  url: string,
): RenderedEmail {
  return renderEmail(
    locale === 'el'
      ? {
          subject: 'Επιβεβαίωσε τη διεύθυνση email σου',
          greeting: `Γεια σου ${name},`,
          paragraphs: [
            'Επιβεβαίωσε ότι αυτή είναι η διεύθυνση email σου, για να μπορείς να καταχωρείς αντικείμενα και να κάνεις κρατήσεις στο BorrowBox.',
            'Ο σύνδεσμος λειτουργεί μία φορά, για 24 ώρες.',
          ],
          action: { label: 'Επιβεβαίωση email', url },
          footer:
            'Λαμβάνεις αυτό το email επειδή δημιουργήθηκε λογαριασμός στο BorrowBox με αυτή τη διεύθυνση. Αν δεν ήσουν εσύ, μπορείς να το αγνοήσεις.',
        }
      : {
          subject: 'Confirm your email address',
          greeting: `Hi ${name},`,
          paragraphs: [
            'Please confirm that this is your email address, so you can list items and make bookings on BorrowBox.',
            'The link works once, for 24 hours.',
          ],
          action: { label: 'Confirm email', url },
          footer:
            "You got this email because a BorrowBox account was created with this address. If it wasn't you, you can ignore it.",
        },
  );
}

export function resetPasswordMessage(
  locale: Locale,
  name: string,
  url: string,
): RenderedEmail {
  return renderEmail(
    locale === 'el'
      ? {
          subject: 'Νέος κωδικός για το BorrowBox',
          greeting: `Γεια σου ${name},`,
          paragraphs: [
            'Ζητήθηκε νέος κωδικός για τον λογαριασμό σου στο BorrowBox. Για να τον ορίσεις, πάτησε τον παρακάτω σύνδεσμο.',
            'Ο σύνδεσμος λειτουργεί μία φορά, για 10 λεπτά. Μόλις ορίσεις νέο κωδικό, θα αποσυνδεθείς από όλες τις συσκευές.',
          ],
          action: { label: 'Ορισμός νέου κωδικού', url },
          footer:
            'Αν δεν το ζήτησες εσύ, αγνόησε αυτό το email: ο κωδικός σου δεν αλλάζει.',
        }
      : {
          subject: 'Choose a new BorrowBox password',
          greeting: `Hi ${name},`,
          paragraphs: [
            'Someone asked for a new password for your BorrowBox account. To choose one, use the link below.',
            'The link works once, for 10 minutes. Once you choose a new password, you are signed out on every device.',
          ],
          action: { label: 'Choose a new password', url },
          footer:
            "If you didn't ask for this, you can ignore this email: your password stays the same.",
        },
  );
}

/** After a password change or reset. `url` leads to asking for a reset link. */
export function passwordChangedMessage(
  locale: Locale,
  name: string,
  url: string,
): RenderedEmail {
  return renderEmail(
    locale === 'el'
      ? {
          subject: 'Ο κωδικός σου στο BorrowBox άλλαξε',
          greeting: `Γεια σου ${name},`,
          paragraphs: [
            'Ο κωδικός του λογαριασμού σου στο BorrowBox μόλις άλλαξε και οι άλλες συσκευές σου αποσυνδέθηκαν.',
            'Αν δεν ήσουν εσύ, ζήτησε αμέσως νέο κωδικό από τον παρακάτω σύνδεσμο.',
          ],
          action: { label: 'Ζήτησε νέο κωδικό', url },
          footer: 'Αυτή είναι μια ειδοποίηση ασφαλείας για τον λογαριασμό σου.',
        }
      : {
          subject: 'Your BorrowBox password was changed',
          greeting: `Hi ${name},`,
          paragraphs: [
            'The password of your BorrowBox account was just changed, and your other devices were signed out.',
            "If this wasn't you, ask for a new password straight away with the link below.",
          ],
          action: { label: 'Ask for a new password', url },
          footer: 'This is a security notice about your account.',
        },
  );
}
