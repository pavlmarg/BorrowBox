import type {
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { isValidPassword } from '@borrowbox/contracts';

/** Same rule as the gateway and Identity (shared in @borrowbox/contracts). */
export const passwordValidator: ValidatorFn = (
  control: AbstractControl<string>,
): ValidationErrors | null =>
  !control.value || isValidPassword(control.value) ? null : { password: true };

/**
 * For a "confirm password" control: must equal its sibling `password`.
 * Re-run it when the password changes (`updateValueAndValidity`).
 */
export const matchesPasswordValidator: ValidatorFn = (
  control: AbstractControl<string>,
): ValidationErrors | null => {
  const password = control.parent?.get('password')?.value;
  return !control.value || control.value === password
    ? null
    : { passwordMismatch: true };
};
