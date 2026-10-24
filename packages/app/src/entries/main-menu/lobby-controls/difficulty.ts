import type { ComputerDifficulty } from '@open-northland/lockstep';
import { components } from '@open-northland/sim';
import { messages } from '../../../i18n/index.js';
import { segControl } from '../../../view/settings/controls.js';

const { COMPUTER_DIFFICULTIES } = components;

/** A computer seat's level as three segments, shared with the network room; `player` keys its focus. */
export function difficultyControl(player: number, change: (difficulty: ComputerDifficulty) => void) {
  const lobby = messages().mainMenu.lobby;
  let current: ComputerDifficulty | null = null;
  const control = segControl(
    COMPUTER_DIFFICULTIES.map((id) => ({ id, label: lobby.difficulty[id] })),
    'medium',
    (difficulty) => {
      if (difficulty !== current) change(difficulty);
    },
  );
  control.root.classList.add('lobby-difficulty');
  control.root.setAttribute('aria-label', lobby.difficultyHeader);
  control.root.title = lobby.difficultyTitle;
  for (const [index, button] of [...control.root.querySelectorAll('button')].entries())
    button.dataset.focus = `difficulty:${player}:${COMPUTER_DIFFICULTIES[index] ?? ''}`;
  return {
    root: control.root,
    update(difficulty: ComputerDifficulty, disabled = false): void {
      current = difficulty;
      control.setActive(difficulty);
      for (const button of control.root.querySelectorAll('button')) button.disabled = disabled;
    },
  };
}
