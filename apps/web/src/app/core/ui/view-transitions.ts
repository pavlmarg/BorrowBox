import { DOCUMENT, inject } from '@angular/core';
import type {
  ActivatedRouteSnapshot,
  ViewTransitionInfo,
} from '@angular/router';

/** Left-to-right order of the auth pages in the sliding card. */
const AUTH_ORDER = ['register', 'login', 'callback'];

const SLIDE_ATTRIBUTE = 'bbSlide'; // → html[data-bb-slide]

function authPage(route: ActivatedRouteSnapshot): string | null {
  let leaf = route;
  const path: string[] = [];
  while (leaf.firstChild) {
    leaf = leaf.firstChild;
    if (leaf.routeConfig?.path) path.push(leaf.routeConfig.path);
  }
  return path[0] === 'auth' ? (path[path.length - 1] ?? null) : null;
}

/**
 * `withViewTransitions({ onViewTransitionCreated })`: between two auth pages,
 * marks the direction on <html> for the sliding-window CSS in styles.scss
 * (register → login slides forward, login → register back). Other
 * navigations keep the default crossfade. Runs in an injection context.
 */
export function authSlideDirection({
  transition,
  from,
  to,
}: ViewTransitionInfo): void {
  const fromIndex = AUTH_ORDER.indexOf(authPage(from) ?? '');
  const toIndex = AUTH_ORDER.indexOf(authPage(to) ?? '');
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

  const root = inject(DOCUMENT).documentElement;
  root.dataset[SLIDE_ATTRIBUTE] = toIndex > fromIndex ? 'forward' : 'back';
  transition.finished.finally(() => delete root.dataset[SLIDE_ATTRIBUTE]);
}
