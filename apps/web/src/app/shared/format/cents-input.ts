import {
  Directive,
  ElementRef,
  effect,
  forwardRef,
  inject,
  untracked,
} from '@angular/core';
import {
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  type AbstractControl,
  type ControlValueAccessor,
  type ValidationErrors,
  type Validator,
  type ValidatorFn,
} from '@angular/forms';
import { LanguageService } from '../../core/i18n/language';
import { centsToInput, parseEuros } from './money';

/**
 * A euro amount field whose form value is integer cents (or null when
 * empty): `<input matInput bbCentsInput formControlName="depositCents">`.
 * Text that isn't a plain amount gives the error `{ euros: true }`.
 */
@Directive({
  selector: 'input[bbCentsInput]',
  host: {
    inputmode: 'decimal',
    autocomplete: 'off',
    '(input)': 'onInput()',
    '(blur)': 'onBlur()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CentsInput),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => CentsInput),
      multi: true,
    },
  ],
})
export class CentsInput implements ControlValueAccessor, Validator {
  private readonly input =
    inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly language = inject(LanguageService);
  private cents: number | null = null;
  private unreadable = false;
  private onChange: (cents: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    // A language switch changes the decimal mark of what's shown.
    effect(() => {
      this.language.formatLocale();
      untracked(() => {
        if (!this.unreadable && document.activeElement !== this.input) {
          this.show(this.cents);
        }
      });
    });
  }

  writeValue(cents: number | null): void {
    this.cents = cents;
    this.unreadable = false;
    this.show(cents);
  }

  registerOnChange(fn: (cents: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.input.disabled = disabled;
  }

  validate(): ValidationErrors | null {
    return this.unreadable ? { euros: true } : null;
  }

  protected onInput(): void {
    const text = this.input.value.trim();
    const cents = text === '' ? null : parseEuros(text);
    this.unreadable = text !== '' && cents === null;
    this.cents = cents;
    this.onChange(cents);
  }

  /** Tidies a readable amount, e.g. `5,5` → `5,50`. */
  protected onBlur(): void {
    if (!this.unreadable) this.show(this.cents);
    this.onTouched();
  }

  private show(cents: number | null): void {
    this.input.value =
      cents === null ? '' : centsToInput(cents, this.language.formatLocale());
  }
}

/** Cents within `[min, max]`; empty passes (combine with `required`). */
export function centsRange(min: number, max: number): ValidatorFn {
  return (control: AbstractControl<number | null>) => {
    const cents = control.value;
    if (cents === null || cents === undefined) return null;
    return cents < min || cents > max ? { centsRange: { min, max } } : null;
  };
}
