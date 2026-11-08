import { MASK, maskContacts } from './masking';

describe('maskContacts', () => {
  it.each([
    ['call me on 6945 123 456', `call me on ${MASK}`],
    ['+30 694 512 3456 anytime', `${MASK} anytime`],
    ['0030-210-1234567', MASK],
    ['(210) 123-4567', MASK],
    ['6945123456', MASK],
    ['+30 (694) 512 34 56', MASK],
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
    'Is it free 21/11/2026 - 23/11/2026?',
    'From 21.11.2026 to 23.11.2026',
    'Any day 10.11 - 15.11 works',
    'Thanks.It works great',
    'Sure, call.me later',
    'Ok.Do you have the charger?',
  ])('leaves %p alone', (text) => {
    expect(maskContacts(text)).toBe(text);
  });

  // The accepted trade-off (ADR-0017: friction, not security).
  it.each(['123 4567', '694.512.3456', 'six nine four five...'])(
    'lets %p through',
    (text) => {
      expect(maskContacts(text)).toBe(text);
    },
  );
});
