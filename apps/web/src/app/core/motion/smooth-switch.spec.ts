import { TestBed } from '@angular/core/testing';
import { SmoothSwitch } from './smooth-switch';

describe('SmoothSwitch', () => {
  afterEach(() => {
    delete (document as Partial<Document>).startViewTransition;
    document.documentElement.classList.remove('bb-switching');
  });

  it('changes at once without the View Transitions API', () => {
    const change = jest.fn();
    TestBed.inject(SmoothSwitch).run(change);
    expect(change).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList).not.toContain('bb-switching');
  });

  it('cross-fades, keeping the clicked button live, then cleans up', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    document.startViewTransition = jest.fn((update) => {
      (update as () => void)();
      return { finished } as ViewTransition;
    }) as Document['startViewTransition'];
    const button = document.createElement('button');
    const change = jest.fn();

    TestBed.inject(SmoothSwitch).run(change, button);
    expect(change).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList).toContain('bb-switching');
    expect(button.style.viewTransitionName).toBe('bb-switch-button');

    finish();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.classList).not.toContain('bb-switching');
    expect(button.style.viewTransitionName).toBe('');
  });
});
