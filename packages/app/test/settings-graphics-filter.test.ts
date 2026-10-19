import { describe, expect, it } from 'vitest';
import { FILTER_CHOICES, filterChoiceOf, filterPatchFor } from '../src/view/settings-graphics-tab.js';
import { defaultSettings } from '../src/view/settings-store.js';

// The control is built from these two, so they carry its whole contract without needing a DOM.
describe('original art filter control', () => {
  it('shows Off while the filter is off, whatever scaler is stored', () => {
    expect(filterChoiceOf({ enhancedSampling: false, pixelArtScaler: 'xbrz' })).toBe('off');
    expect(filterChoiceOf({ enhancedSampling: true, pixelArtScaler: 'xbrz' })).toBe('xbrz');
  });

  it('keeps the stored scaler when the player picks Off, so turning it back on restores their choice', () => {
    const stored = { ...defaultSettings(), enhancedSampling: true, pixelArtScaler: 'xbrz' } as const;
    const off = { ...stored, ...filterPatchFor('off') };
    expect(off.pixelArtScaler).toBe('xbrz');
    expect(off.enhancedSampling).toBe(false);
    expect(filterChoiceOf({ ...off, ...filterPatchFor('xbrz') })).toBe('xbrz');
  });

  it('round-trips every choice through the patch it writes', () => {
    for (const choice of FILTER_CHOICES) {
      const next = { ...defaultSettings(), ...filterPatchFor(choice) };
      expect(filterChoiceOf(next)).toBe(choice);
    }
  });
});
