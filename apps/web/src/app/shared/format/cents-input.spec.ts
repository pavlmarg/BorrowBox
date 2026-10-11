import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { provideTransloco } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language';
import { CentsInput, centsRange } from './cents-input';

@Component({
  imports: [ReactiveFormsModule, CentsInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<input bbCentsInput [formControl]="control" />`,
})
class Host {
  readonly control = new FormControl<number | null>(null, [
    centsRange(10, 100_000),
  ]);
}

async function setup(lang: 'el' | 'en' = 'el') {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'el' },
      }),
    ],
  });
  TestBed.inject(LanguageService).use(lang);
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const input = fixture.nativeElement.querySelector(
    'input',
  ) as HTMLInputElement;
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  return { fixture, input, type, control: fixture.componentInstance.control };
}

describe('CentsInput', () => {
  it('holds cents in the form and euros in the field', async () => {
    const { input, type, control } = await setup('el');
    type('5,5');
    expect(control.value).toBe(550);
    expect(control.valid).toBe(true);

    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('5,50');
  });

  it('shows a value set by code with the language’s decimal mark', async () => {
    const { input, control, fixture } = await setup('en');
    control.setValue(1205);
    await fixture.whenStable();
    expect(input.value).toBe('12.05');
  });

  it('flags text that is not a plain amount', async () => {
    const { type, control } = await setup();
    type('5.000');
    expect(control.value).toBeNull();
    expect(control.errors).toEqual({ euros: true });
  });

  it('applies the range', async () => {
    const { type, control } = await setup();
    type('0,05');
    expect(control.errors).toEqual({
      centsRange: { min: 10, max: 100_000 },
    });
  });

  it('treats an empty field as null', async () => {
    const { type, control } = await setup();
    type('3');
    type('');
    expect(control.value).toBeNull();
    expect(control.valid).toBe(true);
  });
});
