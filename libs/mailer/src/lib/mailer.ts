import { createTransport, type Transporter } from 'nodemailer';

export interface MailerConfig {
  /** SMTP host; undefined disables sending (see `createMailer`). */
  host?: string;
  port: number;
  /** TLS from the start (port 465). Otherwise STARTTLS is used when offered. */
  secure: boolean;
  user?: string;
  password?: string;
  /** The sender, e.g. `BorrowBox <no-reply@borrowbox.gr>`. */
  from: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** Resolves once the SMTP server accepted the message. */
  send(message: EmailMessage): Promise<void>;
  close(): void;
}

/** How long to wait for the SMTP server at each stage. */
const SMTP_TIMEOUT_MS = 10_000;

/**
 * An SMTP mailer, or without `config.host` one that skips every send with a
 * warning (tests, or a service started without email). Errors never contain
 * the message's body or recipient.
 */
export function createMailer(
  config: MailerConfig,
  logger: { warn(message: string): void } = console,
): Mailer {
  if (!config.host) {
    return {
      send: async () => {
        logger.warn('Email sending is disabled (no SMTP host); skipped');
      },
      close: () => undefined,
    };
  }

  const transport: Transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth:
      config.user !== undefined
        ? { user: config.user, pass: config.password ?? '' }
        : undefined,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  return {
    send: async (message) => {
      try {
        await transport.sendMail({ from: config.from, ...message });
      } catch (err) {
        // nodemailer's errors may quote the envelope (the recipient).
        const code = (err as { code?: string }).code ?? 'UNKNOWN';
        throw new Error(`SMTP send failed (${code})`);
      }
    },
    close: () => transport.close(),
  };
}
