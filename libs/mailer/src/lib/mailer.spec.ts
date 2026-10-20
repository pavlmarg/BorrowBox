import { startMailpit, type TestMailpit } from '@borrowbox/testing';
import { renderEmail } from './layout';
import { createMailer } from './mailer';

describe('renderEmail', () => {
  const email = renderEmail({
    subject: 'Confirm your email',
    greeting: 'Hi <Maria>,',
    paragraphs: ['First & second.', 'Third.'],
    action: { label: 'Confirm', url: 'https://example.com/a?b=1&c=2#t=x' },
    footer: 'You got this because you signed up.',
  });

  it('builds a plain-text version with the bare link', () => {
    expect(email.text).toBe(
      [
        'Hi <Maria>,',
        '',
        'First & second.',
        '',
        'Third.',
        '',
        'https://example.com/a?b=1&c=2#t=x',
        '',
        '--',
        'You got this because you signed up.',
        'BorrowBox',
      ].join('\n'),
    );
  });

  it('escapes every value in the HTML version', () => {
    expect(email.html).toContain('Hi &lt;Maria&gt;,');
    expect(email.html).toContain('First &amp; second.');
    expect(email.html).toContain(
      'href="https://example.com/a?b=1&amp;c=2#t=x"',
    );
    expect(email.html).not.toContain('<Maria>');
  });
});

describe('createMailer', () => {
  it('skips sending without an SMTP host', async () => {
    const warn = jest.fn();
    const mailer = createMailer(
      { port: 25, secure: false, from: 'x@example.com' },
      { warn },
    );
    await mailer.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' });
    expect(warn).toHaveBeenCalledWith(
      expect.not.stringContaining('a@example.com'),
    );
  });

  describe('over SMTP (integration)', () => {
    let mailpit: TestMailpit;
    beforeAll(async () => {
      mailpit = await startMailpit();
    });
    afterAll(() => mailpit?.stop());

    it('delivers the message', async () => {
      const mailer = createMailer({
        host: mailpit.smtpHost,
        port: mailpit.smtpPort,
        secure: false,
        from: 'BorrowBox <no-reply@borrowbox.test>',
      });
      const content = renderEmail({
        subject: 'Γεια',
        greeting: 'Γεια σου,',
        paragraphs: ['Καλώς ήρθες.'],
        footer: 'BorrowBox',
      });
      await mailer.send({ to: 'maria@example.com', ...content });
      mailer.close();

      const [email] = await mailpit.waitForEmails('maria@example.com');
      expect(email.subject).toBe('Γεια');
      expect(email.text).toContain('Καλώς ήρθες.');
    });

    it('fails without quoting the recipient when the server is unreachable', async () => {
      const mailer = createMailer({
        host: '127.0.0.1',
        port: 1,
        secure: false,
        from: 'no-reply@borrowbox.test',
      });
      await expect(
        mailer.send({ to: 'secret@example.com', subject: 's', text: 't', html: 'h' }),
      ).rejects.toThrow(/^SMTP send failed \([A-Z]+\)$/);
      mailer.close();
    });
  });
});
