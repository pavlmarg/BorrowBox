import {
  Validators,
  type AbstractControl,
  type ValidationErrors,
  type ValidatorFn,
} from '@angular/forms';
import { bioProblem, normaliseBio } from '@borrowbox/contracts';

/**
 * The public bio (ADR-0025), checked with the server's own rule after the
 * same normalising: `{ bio: 'TOO_LONG' | 'TOO_MANY_LINES' | 'CONTACT_DETAILS' }`.
 */
export const bioRule: ValidatorFn = (
  control: AbstractControl<string>,
): ValidationErrors | null => {
  const problem = bioProblem(normaliseBio(control.value ?? ''));
  return problem ? { bio: problem } : null;
};

/** How many characters of the bio count (as the server counts them). */
export function bioLength(value: string): number {
  return [...normaliseBio(value)].length;
}

/**
 * Length the way the server counts it (class-validator's `Length`, after
 * trimming): an emoji or an accented letter built from a pair of UTF-16
 * units counts once, unlike `string.length` and Angular's `maxLength`.
 */
export function characterCount(value: string): number {
  const text = value.trim();
  const presentation = text.match(/[^️︎][️︎]/g) ?? [];
  const surrogatePairs = text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? [];
  return text.length - presentation.length - surrogatePairs.length;
}

/** At most `max` characters, counted like the server (`maxlength` error). */
export function maxCharacters(max: number): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const length = characterCount(control.value ?? '');
    return length > max
      ? { maxlength: { requiredLength: max, actualLength: length } }
      : null;
  };
}

/**
 * An email address the server accepts too: Angular's check allows a domain
 * without a dot (`maria@example`), which the server's `IsEmail` refuses.
 */
export const emailAddress: ValidatorFn = (
  control: AbstractControl<string>,
): ValidationErrors | null => {
  const value = (control.value ?? '').trim();
  if (!value) return null;
  if (Validators.email(control)) return { email: true };
  return /@[^@\s]+\.[^@\s.]{2,}$/.test(value) ? null : { email: true };
};
