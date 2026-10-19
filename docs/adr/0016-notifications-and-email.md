# ADR-0016: Notifications service, email, and account-security emails

**Status:** Accepted.

## Context
Phase 3 is the first phase that has to reach people outside the app:
- booking requests, answers, expiries and cancellations
- arranging where to meet ([ADR-0015](0015-booking-model.md))
- email verification, password reset and password change for Identity (Phase 1 follow-ups)

ARCHITECTURE.md plans a Notifications service that consumes events and sends email, Web Push and in-app notices. Three things were open:
- whether it starts as its own service or as a module of Bookings, as Messaging and Reviews do
- how email is sent
- how the one-time links for email verification and password reset reach the email

Those links carry a secret token. Whoever has it can verify an address or, worse, set a new password. Putting the raw token in an event means it passes through Identity's outbox, RabbitMQ and possibly a dead-letter queue. It could then turn up in a backup or a debugging session while it is still valid.

## Decision
- **Notifications is its own service**, `apps/notifications`, with its own schema and role. It reacts to events from several services (Identity, Bookings, later Payments), so it doesn't belong inside Bookings. It publishes nothing for now.
- **Recipients come from events.** Notifications keeps a read model of email, display name and language from `user.*` events, and forgets a person on `user.deletion_requested`.
- **Email goes over SMTP with `nodemailer`:** Mailpit locally, a transactional provider's SMTP in production. Changing provider is a configuration change, not a code change.
- **Templates** are plain TypeScript functions returning a subject, a text body and an HTML body, in Greek and English. There's no template engine.
- **Language:** Identity stores each account's language (`el` or `en`), taken from the PWA's language at sign-up and changeable in Settings. It travels in `user.*` events and is part of Identity's data export.
- **Account-security emails are sent by Identity itself.** These are email verification, password reset and the password-change confirmation.
  - Their tokens are 256-bit random values. Identity stores only their SHA-256 hash, and the raw token exists only in Identity's memory and in the email.
  - No event, outbox row or queue ever carries one.
  - Both senders share the SMTP transport and the email layout through a `libs/mailer` library.
- **Token rules:**
  - A password-reset link is valid for **10 minutes**, an email-verification link for **24 hours**.
  - Each works once.
  - Asking for a new link cancels the older ones of the same kind.
  - A successful password reset signs out every session.
- **Scope for Phase 3:** email only. Notification preferences, an in-app inbox and Web Push come later.

## Consequences
- A leaked event, outbox row, queue message or backup never contains a working account-security token. The cost is a second service that sends email: Identity needs SMTP settings too, and `libs/mailer` keeps the two consistent.
- A 10-minute reset link can expire before a delayed email arrives. The PWA must say clearly that the link expired and offer to send a new one.
- An email can't be sent inside a database transaction. If Notifications crashes after sending but before recording the event as processed, the email may go out twice. How to limit that is decided when Notifications is built.
- The email provider becomes a processor of personal data (addresses, names, booking details). It needs a data processing agreement before launch, and emails should carry only what the reader needs.
- Notifications' read model is personal data, so it must be covered by the deletion handler. Identity's export gains the account's language.
