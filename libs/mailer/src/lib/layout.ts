/** What a template fills in; `renderEmail` adds the shared layout. */
export interface EmailContent {
  subject: string;
  /** e.g. "Γεια σου Μαρία," / "Hi Maria,". */
  greeting: string;
  /** Plain text, one entry per paragraph. */
  paragraphs: string[];
  /** A button in HTML, a bare link in the text version. */
  action?: { label: string; url: string };
  /** Small print under the message, e.g. why the reader got it. */
  footer: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const BRAND = 'BorrowBox';
const ACCENT = '#1565c0';

/** The shared layout: a plain-text version and a simple, inline-styled HTML one. */
export function renderEmail(content: EmailContent): RenderedEmail {
  const text = [
    content.greeting,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(content.action ? [content.action.url, ''] : []),
    '--',
    content.footer,
    BRAND,
  ].join('\n');

  const paragraph = (p: string) =>
    `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`;
  const button = content.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(content.action.url)}" ` +
      `style="background:${ACCENT};color:#ffffff;padding:12px 20px;` +
      `border-radius:2px;text-decoration:none;display:inline-block">` +
      `${escapeHtml(content.action.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;color:#555555;word-break:break-all">` +
      `${escapeHtml(content.action.url)}</p>`
    : '';

  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>${escapeHtml(content.subject)}</title></head>` +
    `<body style="margin:0;background:#fafbfc;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 24px">` +
    `<p style="margin:0 0 24px;font-size:20px;font-weight:600;color:${ACCENT}">${BRAND}</p>` +
    paragraph(content.greeting) +
    content.paragraphs.map(paragraph).join('') +
    button +
    `<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0">` +
    `<p style="margin:0;font-size:13px;color:#555555">${escapeHtml(content.footer)}</p>` +
    `</div></body></html>`;

  return { subject: content.subject, text, html };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
