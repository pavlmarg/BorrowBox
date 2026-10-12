import { TestBed } from '@angular/core/testing';
import { Avatar } from './avatar';

async function render(photoUrl: string | null) {
  const fixture = TestBed.createComponent(Avatar);
  fixture.componentRef.setInput('photoUrl', photoUrl);
  fixture.componentRef.setInput('size', 96);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Avatar', () => {
  it('shows the anonymous silhouette without a photo', async () => {
    const el = await render(null);
    expect(el.querySelector('svg.silhouette')).not.toBeNull();
    expect(el.querySelector('img')).toBeNull();
  });

  it('shows the photo when there is one', async () => {
    const el = await render('https://photos.example/a.webp');
    expect(el.querySelector('img')?.getAttribute('src')).toBe(
      'https://photos.example/a.webp',
    );
    expect(el.querySelector('svg')).toBeNull();
  });

  it('is decorative and takes its size', async () => {
    const el = await render(null);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.getPropertyValue('--bb-avatar-size')).toBe('96px');
  });
});
