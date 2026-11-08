import { FormControl } from '@angular/forms';
import { characterCount, emailAddress, maxCharacters } from './validators';

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
