import { centsToInput, formatCents, parseEuros } from './money';

// Intl puts a no-break space between the amount and the sign.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('formatCents', () => {
  it.each([
    [550, 'el-GR', '5,50 €'],
    [550, 'en-GB', '€5.50'],
    [500, 'el-GR', '5 €'],
    [500, 'en-GB', '€5'],
    [10, 'el-GR', '0,10 €'],
    [500_000, 'el-GR', '5.000 €'],
    [500_000, 'en-GB', '€5,000'],
  ])('%i cents in %s → %s', (cents, locale, expected) => {
    expect(plain(formatCents(cents, locale))).toBe(expected);
  });
});

describe('parseEuros', () => {
  it.each([
    ['5', 500],
    ['5,5', 550],
    ['5,50', 550],
    ['5.50', 550],
    ['0,10', 10],
    [' 12 € ', 1200],
    ['€7.05', 705],
    ['5000', 500_000],
  ])('reads %p as %i cents', (text, cents) => {
    expect(parseEuros(text)).toBe(cents);
  });

  it.each([
    ['empty', ''],
    ['a thousands separator', '5.000'],
    ['both separators', '1.000,50'],
    ['three decimals', '5,505'],
    ['a negative amount', '-5'],
    ['letters', 'five'],
    ['a trailing separator', '5,'],
  ])('refuses %s', (_, text) => {
    expect(parseEuros(text)).toBeNull();
  });
});

describe('centsToInput', () => {
  it.each([
    [550, 'el-GR', '5,50'],
    [550, 'en-GB', '5.50'],
    [505, 'el-GR', '5,05'],
    [500, 'en-GB', '5'],
  ])('%i cents in %s → %p, which parses back', (cents, locale, expected) => {
    expect(centsToInput(cents, locale)).toBe(expected);
    expect(parseEuros(expected)).toBe(cents);
  });
});
