/**
 * Keeps the screen on while a handoff code is shown (Screen Wake Lock API).
 * The browser drops the lock when the tab is hidden, so it's taken again on
 * return. Where unsupported (or refused, e.g. low battery) nothing happens:
 * the code still works, the phone may just dim.
 */
export function keepScreenAwake(): () => void {
  const wakeLock = (
    navigator as Navigator & {
      wakeLock?: {
        request(type: 'screen'): Promise<{ release(): Promise<void> }>;
      };
    }
  ).wakeLock;
  if (!wakeLock) return () => undefined;

  let lock: { release(): Promise<void> } | null = null;
  let stopped = false;
  const take = () => {
    if (stopped || document.visibilityState !== 'visible') return;
    wakeLock.request('screen').then(
      (taken) => {
        if (stopped) void taken.release();
        else lock = taken;
      },
      () => undefined,
    );
  };
  take();
  document.addEventListener('visibilitychange', take);
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', take);
    void lock?.release().catch(() => undefined);
    lock = null;
  };
}

/**
 * Full screen hides the address and status bars (Android). It needs a tap,
 * so the booking page asks when its button is pressed; iPhones ignore it.
 */
export function enterFullscreen(): void {
  const root = document.documentElement;
  if (document.fullscreenElement || !root.requestFullscreen) return;
  root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
}

export function leaveFullscreen(): void {
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => undefined);
  }
}
