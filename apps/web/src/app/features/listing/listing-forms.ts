import {
  FormControl,
  FormGroup,
  Validators,
  type AbstractControl,
  type ValidationErrors,
  type ValidatorFn,
} from '@angular/forms';
import {
  DEPOSIT_MAX_CENTS,
  DEPOSIT_MIN_CENTS,
  ITEM_DESCRIPTION_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  ITEM_TITLE_MIN_LENGTH,
  PRICE_FIELD,
  PRICE_UNITS,
  RATE_MAX_CENTS,
  RATE_MIN_CENTS,
  charLength,
  isValidPricing,
  type ItemCategory,
  type ItemPricing,
  type PriceUnit,
} from '@borrowbox/contracts';
import type {
  CreateItemBody,
  OwnItemResponse,
  UpdateItemBody,
} from '../../api/models';
import { centsRange } from '../../shared/format/cents-input';

/**
 * Length in characters (code points), as Catalog counts them, so "🔨🪚"
 * is 2 here and on the server (`charLength` in contracts).
 */
export function charLengthValidator(min: number, max: number): ValidatorFn {
  return (control: AbstractControl<string | null>) => {
    const length = charLength((control.value ?? '').trim());
    if (length === 0 && min === 0) return null;
    return length < min || length > max
      ? { charLength: { min, max, actual: length } }
      : null;
  };
}

export type BasicsForm = FormGroup<{
  title: FormControl<string>;
  category: FormControl<ItemCategory | null>;
  description: FormControl<string>;
}>;

export function basicsForm(): BasicsForm {
  return new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        charLengthValidator(ITEM_TITLE_MIN_LENGTH, ITEM_TITLE_MAX_LENGTH),
      ],
    }),
    category: new FormControl<ItemCategory | null>(null, Validators.required),
    description: new FormControl('', {
      nonNullable: true,
      validators: [charLengthValidator(0, ITEM_DESCRIPTION_MAX_LENGTH)],
    }),
  });
}

export type RatesGroup = FormGroup<
  Record<PriceUnit, FormControl<number | null>>
>;

export type PricingForm = FormGroup<{
  free: FormControl<boolean>;
  rates: RatesGroup;
  depositCents: FormControl<number | null>;
}>;

/** Free, or at least one rate (each €0.10–€1,000), plus a deposit. */
export function pricingForm(): PricingForm {
  const rates = Object.fromEntries(
    PRICE_UNITS.map((unit) => [
      unit,
      new FormControl<number | null>(
        null,
        centsRange(RATE_MIN_CENTS, RATE_MAX_CENTS),
      ),
    ]),
  ) as Record<PriceUnit, FormControl<number | null>>;
  return new FormGroup(
    {
      free: new FormControl(false, { nonNullable: true }),
      rates: new FormGroup(rates),
      depositCents: new FormControl<number | null>(0, [
        Validators.required,
        centsRange(DEPOSIT_MIN_CENTS, DEPOSIT_MAX_CENTS),
      ]),
    },
    { validators: atLeastOneRate },
  );
}

/** Group-level: a priced item needs at least one rate (ADR-0010). */
function atLeastOneRate(group: AbstractControl): ValidationErrors | null {
  const form = group as PricingForm;
  if (form.controls.free.value) return null;
  const any = PRICE_UNITS.some(
    (unit) => form.controls.rates.controls[unit].value !== null,
  );
  return any ? null : { noRate: true };
}

/** The rate card the API expects (only offered units; none when free). */
export function pricingFromForm(form: PricingForm): ItemPricing {
  const { free } = form.getRawValue();
  const pricing: ItemPricing = { free };
  if (free) return pricing;
  for (const unit of PRICE_UNITS) {
    const cents = form.controls.rates.controls[unit].value;
    if (cents !== null) pricing[PRICE_FIELD[unit]] = cents;
  }
  return pricing;
}

export function createBody(
  itemId: string,
  basics: BasicsForm,
  pricing: PricingForm,
): CreateItemBody {
  const b = basics.getRawValue();
  const body: CreateItemBody = {
    itemId,
    title: b.title.trim(),
    category: b.category as ItemCategory,
    pricing: pricingFromForm(pricing),
    depositCents: pricing.controls.depositCents.value ?? 0,
  };
  const description = b.description.trim();
  if (description) body.description = description;
  return body;
}

/** Only what differs from the saved item, or null when nothing does. */
export function updateBody(
  item: OwnItemResponse,
  basics: BasicsForm,
  pricing: PricingForm,
): UpdateItemBody | null {
  const b = basics.getRawValue();
  const body: UpdateItemBody = {};
  const title = b.title.trim();
  const description = b.description.trim();
  if (title !== item.title) body.title = title;
  if (b.category && b.category !== item.category) body.category = b.category;
  if (description !== item.description) body.description = description;
  const next = pricingFromForm(pricing);
  if (
    JSON.stringify(normalised(next)) !==
    JSON.stringify(normalised(item.pricing))
  ) {
    body.pricing = next;
  }
  const deposit = pricing.controls.depositCents.value ?? 0;
  if (deposit !== item.depositCents) body.depositCents = deposit;
  return Object.keys(body).length > 0 ? body : null;
}

/** Same rate card, same JSON: fields in a fixed order, nothing else. */
function normalised(pricing: ItemPricing): ItemPricing {
  const out: ItemPricing = { free: pricing.free };
  for (const unit of PRICE_UNITS) {
    const cents = pricing[PRICE_FIELD[unit]];
    if (cents !== undefined) out[PRICE_FIELD[unit]] = cents;
  }
  return out;
}

/** Fills both forms from a saved item (editing), leaving them pristine. */
export function fillForms(
  item: OwnItemResponse,
  basics: BasicsForm,
  pricing: PricingForm,
): void {
  basics.reset({
    title: item.title,
    category: item.category,
    description: item.description,
  });
  const rates = Object.fromEntries(
    PRICE_UNITS.map((unit) => [unit, item.pricing[PRICE_FIELD[unit]] ?? null]),
  ) as Record<PriceUnit, number | null>;
  pricing.reset({
    free: item.pricing.free,
    rates,
    depositCents: item.depositCents,
  });
}

/** True when the pricing form describes a valid rate card. */
export function pricingIsValid(form: PricingForm): boolean {
  return form.valid && isValidPricing(pricingFromForm(form));
}
