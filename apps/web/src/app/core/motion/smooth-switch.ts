import { ApplicationRef, DOCUMENT, Injectable, inject } from '@angular/core';

/** Set on the clicked button while the page cross-fades, so it stays live. */
const BUTTON_NAME = 'bb-switch-button';

/**
 * Cross-fades the whole page while `change` re-renders it (light/dark,
 * Greek/English): slower and gentler than a route change. The clicked
 * button stays out of the fade so its own click animation shows. Without the
 * View Transitions API, or with reduced motion, the change is instant.
 */
@Injectable({ providedIn: 'root' })
export class SmoothSwitch {
  private readonly document = inject(DOCUMENT);
  private readonly appRef = inject(ApplicationRef);

  run(change: () => void, button?: HTMLElement): void {
    const doc = this.document;
    const reduced = doc.defaultView?.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    )?.matches;
    if (typeof doc.startViewTransition !== 'function' || reduced) {
      change();
      return;
    }
    const root = doc.documentElement;
    root.classList.add('bb-switching');
    if (button) button.style.viewTransitionName = BUTTON_NAME;
    const transition = doc.startViewTransition(() => {
      change();
      // Render the new theme/language now, inside the transition.
      this.appRef.tick();
    });
    transition.finished.finally(() => {
      root.classList.remove('bb-switching');
      if (button) button.style.viewTransitionName = '';
    });
  }
}
