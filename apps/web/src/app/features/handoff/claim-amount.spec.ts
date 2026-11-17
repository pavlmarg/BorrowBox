import { parseEuroCents } from './claim-amount';

describe('parseEuroCents', () => {
  it.each([
    ['30', 3000],
    ['30,5', 3050],
    ['30,50', 3050],
    ['30.50', 3050],
    ['0,99', 99],
    [' 12 ', 1200],
    ['1.000', 100000],
    ['1.000,50', 100050],
    ['12.345.678', 1234567800],
  ])('reads %p as %p cents', (input, cents) => {
    expect(parseEuroCents(input)).toBe(cents);
  });

  it.each([
    '',
    'abc',
    '30,505',
    '30,',
    ',5',
    '-5',
    '1,000.50',
    '1.00.0',
    '€30',
  ])('refuses %p', (input) => {
    expect(parseEuroCents(input)).toBeNull();
  });
});
