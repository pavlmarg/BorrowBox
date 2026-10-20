# @borrowbox/mailer

Sending email for the services that do (ADR-0016): Identity's account-security
emails and, later, Notifications.

- `createMailer(config)` sends over SMTP with `nodemailer`: Mailpit locally,
  a transactional provider's SMTP in production. Without a host it is
  disabled: every send is skipped with a warning, so tests and services that
  don't need email run without an SMTP server.
- `renderEmail(...)` wraps a message in the shared layout and returns its
  subject, plain-text and HTML bodies. Every value is HTML-escaped.

Never log a message's body or recipient: emails carry personal data and
one-time links.
