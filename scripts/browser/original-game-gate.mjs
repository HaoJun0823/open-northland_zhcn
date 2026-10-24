// The browser build asks for an original game folder before the menu and sends `?map=` and `?relay=`
// there until it has one. Browser harnesses mark the check passed before the app reads its settings.

/** `target` is a Playwright page or browser context. */
export function skipOriginalGameGate(target) {
  return target.addInitScript(() => {
    const key = 'open-northland.settings';
    const stored = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    const settings = typeof stored === 'object' && stored !== null ? stored : {};
    window.localStorage.setItem(key, JSON.stringify({ ...settings, originalGameVerified: true }));
  });
}
