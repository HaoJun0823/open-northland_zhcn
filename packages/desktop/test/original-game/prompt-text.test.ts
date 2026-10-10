import { describe, expect, it } from 'vitest';
import { originalGamePromptFor } from '../../src/original-game/prompt-text.js';

describe('originalGamePromptFor', () => {
  it('speaks Polish on a Polish system and English elsewhere', () => {
    expect(originalGamePromptFor('pl').pick).toBe('Wskaż folder gry');
    expect(originalGamePromptFor('pl-PL').buy).toBe('Gdzie kupić');
    expect(originalGamePromptFor('en-US').quit).toBe('Quit');
    expect(originalGamePromptFor('de-DE').pick).toBe('Pick the game folder');
    expect(originalGamePromptFor('').notRecognized).toBe('That folder holds no Cultures game data');
  });

  it('names only the original games', () => {
    for (const locale of ['pl', 'en'])
      expect(originalGamePromptFor(locale).message).not.toMatch(/CulturesNation/);
  });
});
