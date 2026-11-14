import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Api } from '../../api/api';
import {
  meControllerConfirmPhoto,
  meControllerGet,
  meControllerRemovePhoto,
  meControllerRequestPhotoUpload,
} from '../../api/functions';
import type { UserProfileResponse } from '../../api/models';
import { AuthStore } from '../../core/auth/auth.store';
import { prepareProfilePhoto } from './profile-photo-prep';
import { ProfileStore } from './profile.store';

// jsdom has no canvas: the browser-side crop is tested in profile-photo-prep.spec.
jest.mock('./profile-photo-prep', () => ({ prepareProfilePhoto: jest.fn() }));
const prepare = prepareProfilePhoto as jest.MockedFunction<
  typeof prepareProfilePhoto
>;

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

  describe('profile photo', () => {
    const user: UserProfileResponse = {
      id: '6f1b0c55-8d2e-4a3b-9c4d-1e2f3a4b5c6d',
      email: 'ana@example.com',
      displayName: 'Ana',
      locale: 'el',
      emailVerified: true,
      hasPassword: true,
      providers: [],
      photo: null,
      photoUpload: null,
      createdAt: '2026-09-01T10:00:00.000Z',
    };
    const photo = {
      small: 'https://media.test/profiles/k/96.webp',
      large: 'https://media.test/profiles/k/512.webp',
    };
    const target = {
      uploadUrl: 'https://storage.test/borrowbox-uploads/incoming/x',
      uploadHeaders: { 'content-type': 'image/jpeg' },
      expiresAt: '2026-09-01T10:05:00.000Z',
    };

    function setup(answers: Map<unknown, () => unknown>) {
      const invoke = jest.fn((fn: unknown) => {
        const answer = answers.get(fn);
        if (!answer) throw new Error('unexpected API call');
        return Promise.resolve(answer());
      });
      const put = jest.fn(() => of(null));
      const updateUser = jest.fn();
      TestBed.configureTestingModule({
        providers: [
          ProfileStore,
          { provide: Api, useValue: { invoke } },
          { provide: HttpClient, useValue: { put } },
          { provide: AuthStore, useValue: { updateUser } },
        ],
      });
      return { store: TestBed.inject(ProfileStore), invoke, put, updateUser };
    }

    const jpeg = new Blob(['x'], { type: 'image/jpeg' });
    const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' });

    it('uploads straight to storage, confirms, and waits until it is processed', async () => {
      jest.useFakeTimers();
      prepare.mockResolvedValue({
        ok: true,
        blob: jpeg,
        contentType: 'image/jpeg',
      });
      const polls = [
        { ...user, photoUpload: 'PENDING' },
        { ...user, photo },
      ];
      const { store, invoke, put, updateUser } = setup(
        new Map<unknown, () => unknown>([
          [meControllerRequestPhotoUpload, () => target],
          [
            meControllerConfirmPhoto,
            () => ({ ...user, photoUpload: 'PENDING' }),
          ],
          [meControllerGet, () => polls.shift()],
        ]),
      );

      const done = store.changePhoto(file);
      await jest.runAllTimersAsync();
      await done;

      expect(invoke).toHaveBeenCalledWith(meControllerRequestPhotoUpload, {
        body: { contentType: 'image/jpeg', sizeBytes: jpeg.size },
      });
      expect(put).toHaveBeenCalledWith(target.uploadUrl, jpeg, {
        headers: expect.anything(),
      });
      expect(updateUser).toHaveBeenLastCalledWith({ ...user, photo });
      expect(store.photoStep()).toBe('idle');
      expect(store.photoProblem()).toBeNull();
    });

    it('says so when the server refused the image', async () => {
      prepare.mockResolvedValue({
        ok: true,
        blob: jpeg,
        contentType: 'image/jpeg',
      });
      const { store } = setup(
        new Map<unknown, () => unknown>([
          [meControllerRequestPhotoUpload, () => target],
          [
            meControllerConfirmPhoto,
            () => ({ ...user, photoUpload: 'FAILED' }),
          ],
        ]),
      );
      await store.changePhoto(file);
      expect(store.photoProblem()).toBe('REJECTED');
    });

    it('stops before uploading a file the server would refuse', async () => {
      prepare.mockResolvedValue({ ok: false, problem: 'tooSmall' });
      const { store, invoke, put } = setup(new Map());
      await store.changePhoto(file);
      expect(store.photoProblem()).toBe('tooSmall');
      expect(invoke).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    });

    it('removes the photo', async () => {
      const { store, updateUser } = setup(
        new Map<unknown, () => unknown>([
          [meControllerRemovePhoto, () => user],
        ]),
      );
      await store.removePhoto();
      expect(updateUser).toHaveBeenCalledWith(user);
      expect(store.photoStep()).toBe('idle');
    });
  });
});
