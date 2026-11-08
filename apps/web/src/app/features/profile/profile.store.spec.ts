import { TestBed } from '@angular/core/testing';
import { Api } from '../../api/api';
import { AuthStore } from '../../core/auth/auth.store';
import { ProfileStore } from './profile.store';

describe('ProfileStore', () => {
  afterEach(() => jest.useRealTimers());

  it('downloads the export from an attached link, revoking its URL only later', async () => {
    jest.useFakeTimers();
    const createObjectURL = jest.fn(() => 'blob:export');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    TestBed.configureTestingModule({
      providers: [
        ProfileStore,
        {
          provide: Api,
          useValue: { invoke: jest.fn().mockResolvedValue({ identity: {} }) },
        },
        { provide: AuthStore, useValue: {} },
      ],
    });
    const store = TestBed.inject(ProfileStore);
    const clicked: Array<{ download: string; attached: boolean }> = [];
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({
          download: this.download,
          attached: document.body.contains(this),
        });
      });

    await store.exportData();

    expect(clicked).toEqual([
      { download: 'borrowbox-data-export.json', attached: true },
    ]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
    expect(store.exported()).toBe(true);
    click.mockRestore();
  });
});
