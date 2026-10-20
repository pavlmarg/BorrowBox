import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { MAILPIT_IMAGE, STARTUP_TIMEOUT_MS } from './images';

/** One caught email, as Mailpit's API returns it. */
export interface CaughtEmail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface TestMailpit {
  container: StartedTestContainer;
  smtpHost: string;
  smtpPort: number;
  /** Every email sent to `address` so far, oldest first. */
  emailsTo(address: string): Promise<CaughtEmail[]>;
  /** Waits until `address` has received at least `count` emails, then returns them all. */
  waitForEmails(
    address: string,
    count?: number,
    timeoutMs?: number,
  ): Promise<CaughtEmail[]>;
  stop(): Promise<void>;
}

interface MessageSummary {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
}

/** Mailpit catching all SMTP mail, like `docker compose` in dev. */
export async function startMailpit(): Promise<TestMailpit> {
  const container = await new GenericContainer(MAILPIT_IMAGE)
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp('/readyz', 8025))
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
  const api = `http://${container.getHost()}:${container.getMappedPort(8025)}/api/v1`;

  const getJson = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${api}${path}`);
    if (!res.ok) throw new Error(`Mailpit API ${path}: ${res.status}`);
    return (await res.json()) as T;
  };

  const emailsTo = async (address: string): Promise<CaughtEmail[]> => {
    const { messages } = await getJson<{ messages: MessageSummary[] }>(
      `/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=200`,
    );
    // Mailpit lists newest first.
    const ids = messages
      .filter((m) =>
        m.To.some((t) => t.Address.toLowerCase() === address.toLowerCase()),
      )
      .map((m) => m.ID)
      .reverse();
    return Promise.all(
      ids.map(async (id) => {
        const m = await getJson<{
          To: Array<{ Address: string }>;
          Subject: string;
          Text: string;
          HTML: string;
        }>(`/message/${id}`);
        return {
          to: m.To.map((t) => t.Address),
          subject: m.Subject,
          text: m.Text,
          html: m.HTML,
        };
      }),
    );
  };

  return {
    container,
    smtpHost: container.getHost(),
    smtpPort: container.getMappedPort(1025),
    emailsTo,
    waitForEmails: async (address, count = 1, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const emails = await emailsTo(address);
        if (emails.length >= count) return emails;
        if (Date.now() > deadline) {
          throw new Error(
            `Expected ${count} email(s) to ${address}, got ${emails.length}`,
          );
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    stop: async () => {
      await container.stop();
    },
  };
}
