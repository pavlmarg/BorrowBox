import { createTransport, type Transporter } from 'nodemailer';

export interface MailerConfig {
  /** SMTP host; undefined disables sending (see `createMailer`). */
  host?: string;
  port: number;
  /**
   * TLS from the start (port 465). Otherwise STARTTLS: required when `user`
   * is set (so a downgraded connection never carries the password), used
   * when offered without credentials (Mailpit in dev).
   */
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
  /** False without an SMTP host: `send` then skips the message. */
  readonly enabled: boolean;
  /** Resolves once the SMTP server accepted the message (or skipped it, when disabled). */
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
      enabled: false,
      send: async () => {
        logger.warn('Email sending is disabled (no SMTP host); skipped');
      },
      close: () => undefined,
    };
  }

  // An empty user means none: Nest's ConfigService hands back the raw ''
  // of an empty `SMTP_USER=` line, even when the config turned it into
  // undefined, and STARTTLS would then be required of Mailpit.
  const user = config.user || undefined;
  const transport: Transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure && user !== undefined,
    auth:
      user !== undefined ? { user, pass: config.password ?? '' } : undefined,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  return {
    enabled: true,
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
