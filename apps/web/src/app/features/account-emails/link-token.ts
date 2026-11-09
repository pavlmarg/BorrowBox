/**
 * Reads the token of an email link (`#t=<token>`) and removes the fragment
 * from the address bar at once, so it doesn't stay in the browser's history
 * or get copied along with the URL. Fragments never reach a server.
 *
 * Returns null when the URL has no token (e.g. the page was reloaded after
 * the token was taken).
 */
export function takeLinkToken(doc: Document): string | null {
  const win = doc.defaultView;
  if (!win) return null;
  const { hash, pathname, search } = win.location;
  if (!hash) return null;
  const token = new URLSearchParams(hash.slice(1)).get('t');
  // Keep the router's history state (its navigation id) as it is.
  win.history.replaceState(win.history.state, '', pathname + search);
  return token ? token : null;
}
