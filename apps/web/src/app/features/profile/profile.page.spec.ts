import { initials } from './profile.page';

describe('initials', () => {
  it.each([
    ['Maria Papadopoulou', 'MP'],
    ['maria', 'M'],
    ['  Νίκος   Γεωργίου  ', 'ΝΓ'],
    ['Anna Maria Smith', 'AS'],
    ['', '?'],
  ])('%j → %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
