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
