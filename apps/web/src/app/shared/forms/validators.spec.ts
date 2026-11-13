import { FormControl } from '@angular/forms';
import {
  bioLength,
  bioRule,
  characterCount,
  emailAddress,
  maxCharacters,
} from './validators';

describe('bio rule (ADR-0025)', () => {
  it.each([
    ['', null],
    ['  After 9, please  ', null],
    ['a'.repeat(151), { bio: 'TOO_LONG' }],
    ['a\nb\nc\nd', { bio: 'TOO_MANY_LINES' }],
    ['Call 6912345678', { bio: 'CONTACT_DETAILS' }],
  ])('checks %p like the server', (bio, errors) => {
    expect(bioRule(new FormControl(bio))).toEqual(errors);
  });

  it('counts the normalised bio', () => {
    expect(bioLength('  Hi 😀\r\nthere  ')).toBe(10);
  });
});

describe('form validators', () => {
  it.each([
    ['Maria', 5],
    ['  Maria  ', 5],
    ['Μαρία', 5],
    ['😀😀', 2],
    ['❤️', 1],
  ])('counts %p as %i characters, like the server', (text, count) => {
    expect(characterCount(text)).toBe(count);
  });

  it('allows 50 emoji in a 50-character name', () => {
    const validator = maxCharacters(50);
    expect(validator(new FormControl('😀'.repeat(50)))).toBeNull();
    expect(validator(new FormControl('😀'.repeat(51)))).toEqual({
      maxlength: { requiredLength: 50, actualLength: 51 },
    });
  });

  it.each([
    ['maria@example.com', true],
    ['maria@example', false],
    ['maria@example.c', false],
    ['maria', false],
    ['', true],
  ])('%p is an acceptable email: %s', (value, ok) => {
    expect(emailAddress(new FormControl(value))).toEqual(
      ok ? null : { email: true },
    );
  });
});
