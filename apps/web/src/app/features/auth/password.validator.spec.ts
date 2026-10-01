import { FormControl, FormGroup } from '@angular/forms';
import { matchesPasswordValidator } from './password.validator';

describe('matchesPasswordValidator', () => {
  const form = () =>
    new FormGroup({
      password: new FormControl('secret123', { nonNullable: true }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: matchesPasswordValidator,
      }),
    });

  it('accepts a matching confirmation', () => {
    const f = form();
    f.controls.confirmPassword.setValue('secret123');
    expect(f.controls.confirmPassword.valid).toBe(true);
  });

  it('flags a different confirmation', () => {
    const f = form();
    f.controls.confirmPassword.setValue('secret124');
    expect(f.controls.confirmPassword.errors).toEqual({
      passwordMismatch: true,
    });
  });

  it('leaves an empty confirmation to the required validator', () => {
    expect(form().controls.confirmPassword.valid).toBe(true);
  });
});
