import { timeLeft } from './time-left';
import { cssColourToHex, stripeAppearance } from './stripe-appearance';

describe('stripeAppearance', () => {
  it('makes Stripe’s form square and flat, in the page’s colours', () => {
    const appearance = stripeAppearance({
      primary: '#1f6fb2',
      background: '#fafbfc',
      text: '#1a1c1e',
      border: '#c3c7cf',
      danger: '#ba1a1a',
    });
    expect(appearance.variables).toMatchObject({
      borderRadius: '0px',
      colorPrimary: '#1f6fb2',
      colorBackground: '#fafbfc',
      colorText: '#1a1c1e',
      colorDanger: '#ba1a1a',
    });
    expect(appearance.variables?.fontFamily).toMatch(/^Inter, system-ui/);
    expect(appearance.rules?.['.Input']).toEqual({
      boxShadow: 'none',
      border: '1px solid #c3c7cf',
    });
  });

  it('leaves colours it could not read to Stripe', () => {
    const { variables, rules } = stripeAppearance({});
    expect(variables).not.toHaveProperty('colorPrimary');
    expect(variables).not.toHaveProperty('colorText');
    expect(rules?.['.Input']).toEqual({ boxShadow: 'none' });
  });
});

describe('cssColourToHex', () => {
  it.each([
    ['rgb(31, 111, 178)', '#1f6fb2'],
    ['rgb(31 111 178)', '#1f6fb2'],
    ['rgba(250, 251, 252, 1)', '#fafbfc'],
    ['rgba(0, 0, 0, 0)', null],
    ['var(--mat-sys-primary)', null],
    ['', null],
  ])('%s → %s', (value, hex) => {
    expect(cssColourToHex(value)).toBe(hex);
  });
});

describe('timeLeft', () => {
  const now = Date.parse('2026-11-09T10:00:00.000Z');

  it('counts whole hours and minutes, rounding down', () => {
    expect(timeLeft('2026-11-09T12:15:59.000Z', now)).toEqual({
      hours: 2,
      minutes: 15,
    });
    expect(timeLeft('2026-11-09T10:00:30.000Z', now)).toEqual({
      hours: 0,
      minutes: 0,
    });
  });

  it('is null once the time passed', () => {
    expect(timeLeft('2026-11-09T10:00:00.000Z', now)).toBeNull();
    expect(timeLeft('not a date', now)).toBeNull();
  });
});
