import type { ComputerDifficulty, ComputerModuleEnables } from '../../components/ai-control.js';

/** Changes machine identity and the permissions of its two controllers. */
export type AiControlCommand = {
  /** Omitted controller/module permissions default to enabled. Existing difficulty and peace are retained. */
  readonly kind: 'setAiControl';
  /** The player slot (`[0, MAX_PLAYERS)`); an out-of-range slot skips the command. */
  readonly player: number;
  /** False removes machine identity, including special machine unit rules. */
  readonly enabled: boolean;
  readonly modules?: Partial<ComputerModuleEnables>;
  readonly computerEnabled?: boolean;
  readonly mapAiEnabled?: boolean;
  readonly peaceUntil?: number;
  readonly difficulty?: ComputerDifficulty;
};
