import type { Appearance } from '@stripe/stripe-js';

/** The page's colours, as `#rrggbb`; missing ones keep Stripe's defaults. */
export interface ThemeColours {
  primary?: string;
  background?: string;
  text?: string;
  textSecondary?: string;
  danger?: string;
  border?: string;
}

/** CSS variables each colour is read from (styles.scss / Material). */
export const THEME_VARIABLES: Record<keyof ThemeColours, string> = {
  primary: '--mat-sys-primary',
  background: '--bb-page-bg',
  text: '--mat-sys-on-surface',
  textSecondary: '--mat-sys-on-surface-variant',
  danger: '--mat-sys-error',
  border: '--mat-sys-outline-variant',
};

/**
 * The app's font stack. Stripe's form runs in its own frame, which can't use
 * our self-hosted Inter, so it gets Inter only where installed and system
 * fonts otherwise (never a font CDN: GDPR).
 */
const FONT_FAMILY =
  "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif";

/**
 * Stripe's Appearance API set to the signed-in pages' look: flat, square
 * fields (radius 0), no shadows, the page's colours.
 */
export function stripeAppearance(colours: ThemeColours): Appearance {
  const { primary, background, text, textSecondary, danger, border } = colours;
  const variables: NonNullable<Appearance['variables']> = {
    fontFamily: FONT_FAMILY,
    borderRadius: '0px',
    focusBoxShadow: 'none',
  };
  if (primary) variables.colorPrimary = primary;
  if (background) variables.colorBackground = background;
  if (text) variables.colorText = text;
  if (textSecondary) variables.colorTextSecondary = textSecondary;
  if (danger) variables.colorDanger = danger;

  const line = border ? `1px solid ${border}` : undefined;
  const focus: Record<string, string> = primary
    ? { borderColor: primary, boxShadow: `0 0 0 1px ${primary}` }
    : {};
  return {
    theme: 'stripe',
    variables,
    rules: {
      '.Input': { boxShadow: 'none', ...(line ? { border: line } : {}) },
      '.Input:focus': focus,
      '.Tab': { boxShadow: 'none', ...(line ? { border: line } : {}) },
      '.Tab--selected': focus,
      '.Tab--selected:focus': focus,
    },
  };
}

/** `rgb(31, 111, 178)` → `#1f6fb2`; null for anything else or transparent. */
export function cssColourToHex(value: string): string | null {
  const match =
    /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+)%?)?\s*\)$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const [, r, g, b, alpha] = match;
  if (alpha !== undefined && Number(alpha) === 0) return null;
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.min(255, Number(c)).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Reads the theme's current colours where `host` sits (so the app shell's
 * values apply). A probe resolves each variable to a real colour, whatever
 * it's written as (`light-dark()`, another variable, …), since Stripe only
 * understands plain colours.
 */
export function readThemeColours(host: HTMLElement): ThemeColours {
  const view = host.ownerDocument.defaultView;
  if (!view) return {};
  const probe = host.ownerDocument.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  const colours: ThemeColours = {};
  try {
    for (const [name, variable] of Object.entries(THEME_VARIABLES) as [
      keyof ThemeColours,
      string,
    ][]) {
      probe.style.color = '';
      probe.style.color = `var(${variable})`;
      const hex = cssColourToHex(view.getComputedStyle(probe).color);
      if (hex) colours[name] = hex;
    }
  } finally {
    probe.remove();
  }
  return colours;
}
