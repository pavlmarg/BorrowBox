import type { OwnItemResponse } from '../../api/models';
import {
  basicsForm,
  createBody,
  fillForms,
  pricingForm,
  pricingFromForm,
  pricingIsValid,
  updateBody,
} from './listing-forms';

const saved: OwnItemResponse = {
  id: 'i-1',
  status: 'DRAFT',
  title: 'Drill',
  description: '',
  category: 'tools',
  pricing: { free: false, dailyCents: 800 },
  depositCents: 0,
  location: null,
  approximateLocation: null,
  photos: [],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  publishedAt: null,
};

describe('basics form', () => {
  it('counts the title in characters, like the server', () => {
    const form = basicsForm();
    form.controls.title.setValue('🔨🪚');
    expect(form.controls.title.errors?.['charLength']).toMatchObject({
      actual: 2,
    });
    form.controls.title.setValue('🔨🪚🛠');
    expect(form.controls.title.valid).toBe(true);
  });

  it('needs a category', () => {
    const form = basicsForm();
    form.patchValue({ title: 'Ladder' });
    expect(form.valid).toBe(false);
    form.patchValue({ category: 'diy-ladders' });
    expect(form.valid).toBe(true);
  });
});

describe('pricing form', () => {
  it('needs at least one rate unless the item is free', () => {
    const form = pricingForm();
    expect(form.errors).toEqual({ noRate: true });
    form.controls.free.setValue(true);
    expect(form.errors).toBeNull();
    form.controls.free.setValue(false);
    form.controls.rates.controls.WEEK.setValue(3500);
    expect(form.errors).toBeNull();
    expect(pricingIsValid(form)).toBe(true);
  });

  it('sends only the offered rates, and none for a free item', () => {
    const form = pricingForm();
    form.controls.rates.controls.HOUR.setValue(150);
    form.controls.rates.controls.MONTH.setValue(9000);
    expect(pricingFromForm(form)).toEqual({
      free: false,
      hourlyCents: 150,
      monthlyCents: 9000,
    });
    form.controls.free.setValue(true);
    expect(pricingFromForm(form)).toEqual({ free: true });
  });

  it('refuses rates out of range', () => {
    const form = pricingForm();
    form.controls.rates.controls.DAY.setValue(5);
    expect(pricingIsValid(form)).toBe(false);
  });
});

describe('request bodies', () => {
  it('creates with trimmed text and the client’s id', () => {
    const basics = basicsForm();
    const pricing = pricingForm();
    basics.setValue({ title: ' Drill ', category: 'tools', description: '  ' });
    pricing.controls.rates.controls.DAY.setValue(800);
    expect(createBody('i-1', basics, pricing)).toEqual({
      itemId: 'i-1',
      title: 'Drill',
      category: 'tools',
      pricing: { free: false, dailyCents: 800 },
      depositCents: 0,
    });
  });

  it('updates only what changed', () => {
    const basics = basicsForm();
    const pricing = pricingForm();
    fillForms(saved, basics, pricing);
    expect(updateBody(saved, basics, pricing)).toBeNull();

    basics.controls.title.setValue('Bosch drill');
    pricing.controls.depositCents.setValue(5000);
    expect(updateBody(saved, basics, pricing)).toEqual({
      title: 'Bosch drill',
      depositCents: 5000,
    });
  });

  it('sends the whole rate card when any rate changes', () => {
    const basics = basicsForm();
    const pricing = pricingForm();
    fillForms(saved, basics, pricing);
    pricing.controls.rates.controls.WEEK.setValue(3500);
    expect(updateBody(saved, basics, pricing)).toEqual({
      pricing: { free: false, dailyCents: 800, weeklyCents: 3500 },
    });
  });
});
