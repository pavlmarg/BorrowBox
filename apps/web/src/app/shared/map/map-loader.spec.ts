import { retryableOnce } from './map-loader';

describe('retryableOnce', () => {
  it('loads once and shares the result', async () => {
    const load = jest.fn().mockResolvedValue('maplibre');
    const get = retryableOnce(load);
    await expect(Promise.all([get(), get()])).resolves.toEqual([
      'maplibre',
      'maplibre',
    ]);
    await get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failed load', async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('maplibre');
    const get = retryableOnce(load);
    await expect(get()).rejects.toThrow('offline');
    await expect(get()).resolves.toBe('maplibre');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
