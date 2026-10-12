import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { PhotoViewer } from './photo-viewer';

describe('PhotoViewer', () => {
  it('shows the photo at its largest size, and zooms back out on a click', async () => {
    const close = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            photo: {
              id: 'a',
              urls: { small: '/a-s', medium: '/a-m', large: '/a-l' },
            },
            title: 'Drill',
          },
        },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(PhotoViewer);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const img = el.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/a-l');
    expect(img.alt).toBe('Drill');
    // Nothing else: no arrows, thumbnails or counter.
    expect(el.querySelectorAll('button')).toHaveLength(0);

    img.click();
    expect(close).toHaveBeenCalled();
  });
});
