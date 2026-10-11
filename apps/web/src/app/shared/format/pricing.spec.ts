import { cardRate, offeredRates } from './pricing';

describe('offeredRates', () => {
  it('lists the offered rates, shortest unit first', () => {
    expect(
      offeredRates({ free: false, monthlyCents: 9000, hourlyCents: 200 }),
    ).toEqual([
      { unit: 'HOUR', cents: 200 },
      { unit: 'MONTH', cents: 9000 },
    ]);
  });

  it('is empty for a free item', () => {
    expect(offeredRates({ free: true })).toEqual([]);
  });
});

describe('cardRate', () => {
  it('shows the daily rate when there is one', () => {
    expect(
      cardRate({ free: false, hourlyCents: 200, dailyCents: 1000 }),
    ).toEqual({
      free: false,
      rate: { unit: 'DAY', cents: 1000 },
      moreRates: 1,
    });
  });

  it('else the shortest unit offered', () => {
    expect(
      cardRate({ free: false, weeklyCents: 4000, monthlyCents: 9000 }),
    ).toEqual({
      free: false,
      rate: { unit: 'WEEK', cents: 4000 },
      moreRates: 1,
    });
  });

  it('says free for free items', () => {
    expect(cardRate({ free: true })).toEqual({ free: true });
  });
});
