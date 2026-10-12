import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { ListingStore } from './listing.store';
import { PhotosStep } from './photos-step';

function setup(options: { touch?: boolean; slots?: number } = {}) {
  window.matchMedia = jest
    .fn()
    .mockReturnValue({ matches: options.touch ?? false });
  const store = {
    photoSlotsLeft: signal(options.slots ?? 10),
    sortedPhotos: signal([]),
    uploads: signal([]),
    addPhotos: jest.fn().mockReturnValue(0),
    removePhoto: jest.fn(),
    dismissUpload: jest.fn(),
    reorder: jest.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      { provide: ListingStore, useValue: store },
    ],
  });
  const fixture = TestBed.createComponent(PhotosStep);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, store };
}

/** A drag event carrying files, as the browser makes one. */
function fileDrag(type: string, files: File[] = []): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: 'none' },
  });
  return event;
}

const jpeg = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

describe('PhotosStep', () => {
  it('takes photos dropped on the drop area, like chosen ones', () => {
    const { el, fixture, store } = setup();
    const drop = el.querySelector('.drop') as HTMLElement;

    drop.dispatchEvent(fileDrag('dragenter'));
    fixture.detectChanges();
    expect(drop.classList).toContain('over');
    expect(drop.textContent).toContain('listing.dropRelease');

    const files = [jpeg('a.jpg'), jpeg('b.jpg')];
    const event = fileDrag('drop', files);
    drop.dispatchEvent(event);
    fixture.detectChanges();
    expect(event.defaultPrevented).toBe(true);
    expect(store.addPhotos).toHaveBeenCalledWith(files);
    expect(drop.classList).not.toContain('over');
  });

  it('ignores drags that carry no files, and drops when full', () => {
    const { el, store } = setup({ slots: 0 });
    const drop = el.querySelector('.drop') as HTMLElement;
    const notFiles = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(notFiles, 'dataTransfer', {
      value: { types: ['text/plain'], files: [] },
    });
    drop.dispatchEvent(notFiles);
    drop.dispatchEvent(fileDrag('drop', [jpeg('a.jpg')]));
    expect(store.addPhotos).not.toHaveBeenCalled();
  });

  it('offers the camera as a round button on phones, instead of the drop area', () => {
    const { el } = setup({ touch: true });
    expect(el.querySelector('.drop')).toBeNull();
    const camera = el.querySelector('button.camera');
    expect(camera?.getAttribute('aria-label')).toBe('listing.takePhoto');
    expect(el.textContent).toContain('listing.choosePhotos');
  });
});
