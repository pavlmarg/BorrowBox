import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideTransloco } from '@jsverse/transloco';
import type { PublicPhotoResponse } from '../../api/models';
import { CLICK_SCALE, MAX_SCALE, PhotoViewer } from './photo-viewer';

const photo = (id: string): PublicPhotoResponse => ({
  id,
  urls: {
    small: `/p/${id}-s.webp`,
    medium: `/p/${id}-m.webp`,
    large: `/p/${id}-l.webp`,
  },
});

async function render(index = 0) {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      {
        provide: MAT_DIALOG_DATA,
        useValue: { photos: ['a', 'b', 'c'].map(photo), index, title: 'Drill' },
      },
    ],
  });
  const fixture = TestBed.createComponent(PhotoViewer);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const stage = el.querySelector('.stage') as HTMLElement;
  const img = () => el.querySelector('.stage img') as HTMLImageElement;
  const pointer = (type: string, x = 0, y = 0) => {
    stage.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }),
    );
    fixture.detectChanges();
  };
  return { fixture, el, stage, img, pointer };
}

const scaleOf = (img: HTMLImageElement) =>
  Number(/scale\(([\d.]+)\)/.exec(img.style.transform)?.[1]);

describe('PhotoViewer', () => {
  it('starts on the photo that was clicked, at its largest size', async () => {
    const { img, el } = await render(1);
    expect(img().getAttribute('src')).toBe('/p/b-l.webp');
    expect(el.querySelector('.counter')?.textContent).toContain(
      'item.photoCount',
    );
  });

  it('moves between photos with the arrows and the keys, wrapping around', async () => {
    const { el, img, fixture } = await render(0);
    (el.querySelector('.arrow.prev') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(img().getAttribute('src')).toBe('/p/c-l.webp');

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(img().getAttribute('src')).toBe('/p/a-l.webp');

    (el.querySelectorAll('.thumb')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(img().getAttribute('src')).toBe('/p/b-l.webp');
  });

  it('zooms in on a click, and back out on the next', async () => {
    const { img, pointer } = await render();
    expect(scaleOf(img())).toBe(1);
    pointer('pointerdown');
    pointer('pointerup');
    expect(scaleOf(img())).toBe(CLICK_SCALE);
    pointer('pointerdown');
    pointer('pointerup');
    expect(scaleOf(img())).toBe(1);
  });

  it('zooms with the wheel, never past its limit, and resets on another photo', async () => {
    const { img, stage, fixture, el } = await render();
    for (let i = 0; i < 20; i++) {
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -200 }));
    }
    fixture.detectChanges();
    expect(scaleOf(img())).toBe(MAX_SCALE);

    (el.querySelector('.arrow.next') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(scaleOf(img())).toBe(1);
  });

  it('treats a drag as a drag, not a click', async () => {
    const { img, pointer } = await render();
    pointer('pointerdown', 0, 0);
    pointer('pointermove', 40, 0);
    pointer('pointerup', 40, 0);
    expect(scaleOf(img())).toBe(1);
  });
});
