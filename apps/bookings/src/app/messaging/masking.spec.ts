import { MASK, maskContacts } from './masking';

describe('maskContacts', () => {
  it.each([
    ['call me on 6945 123 456', `call me on ${MASK}`],
    ['+30 694 512 3456 anytime', `${MASK} anytime`],
    ['0030-210-1234567', MASK],
    ['(210) 123.4567', MASK],
    ['write to maria.k@example.com', `write to ${MASK}`],
    ['γράψε στο μαρία@παράδειγμα.gr', `γράψε στο ${MASK}`],
    ['see https://example.com/drill?x=1 ok', `see ${MASK} ok`],
    ['www.example.org', MASK],
    ['my shop is maria.gr/tools', `my shop is ${MASK}`],
  ])('masks %p', (text, expected) => {
    expect(maskContacts(text)).toBe(expected);
  });

  it.each([
    'Would you do €25 for the weekend?',
    'Is it free on 21/10?',
    'I need it from 10:00 to 18:00, 2 days',
    'The drill is 1500 W',
    'Μπορώ να το πάρω την Τρίτη;',
  ])('leaves %p alone', (text) => {
    expect(maskContacts(text)).toBe(text);
  });
});
