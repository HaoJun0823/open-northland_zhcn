// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { messages } from '../src/i18n/index.js';
import { createSettingsPage } from '../src/view/settings-page.js';
import { patchStoredSettings, readStoredSettings } from '../src/view/settings-store.js';

const scope = new AbortController();
afterEach(() => {
  scope.abort();
  document.body.replaceChildren();
  localStorage.clear();
});

it('remembers the selected interval in a fresh settings surface without losing keyboard focus', async () => {
  const mount = () => {
    const page = createSettingsPage({
      settings: {
        current: readStoredSettings,
        update: async (patch) => {
          patchStoredSettings(patch);
          return true;
        },
        pinnedUiScale: null,
        effectiveUiScaleFor: (factor) => factor,
      },
      memory: { tab: 'saving' },
      signal: scope.signal,
      hud: true,
    });
    document.body.append(page.el);
    return page;
  };
  const page = mount();
  const choices = [...page.el.querySelectorAll<HTMLButtonElement>('.main-menu__seg-btn')];
  expect(choices).toHaveLength(5);
  expect(choices[0]?.textContent).toBe(messages().mainMenu.settings.autosaveOff);
  expect(choices[0]?.getAttribute('aria-pressed')).toBe('true');
  choices[3]?.focus();
  choices[3]?.click();
  await Promise.resolve();
  expect(readStoredSettings().autosaveMinutes).toBe(15);
  expect(choices[3]?.getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(choices[3]);
  page.dispose();
  page.el.remove();
  const reopened = mount();
  expect(reopened.el.querySelector('.main-menu__seg-btn[aria-pressed="true"]')?.textContent).toBe(
    messages().mainMenu.settings.autosaveEvery.replace('{n}', '15'),
  );
});
