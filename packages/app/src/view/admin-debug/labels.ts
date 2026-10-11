import type { Messages } from '../../i18n/index.js';
import type { DebugAction } from './actions-catalog.js';
import type { AnimalEntry, CreaturePreset } from './spawn-catalog.js';

export interface AdminLabels {
  /** The live localized name, else the catalog id. */
  readonly good: (entry: { readonly good: number; readonly id: string }) => string;
  readonly creature: (preset: CreaturePreset) => string;
  /** The localized species name, falling back to the content tribe slug. */
  readonly animal: (entry: AnimalEntry) => string;
  readonly action: (action: DebugAction) => string;
  readonly player: (player: number) => string;
}

export function createAdminLabels(
  messages: Messages,
  goodLabel: ((typeId: number) => string | undefined) | undefined,
): AdminLabels {
  const copy = messages.admin;
  const goodNames = messages.goods;

  const goodLabelOf = (good: number, fallback: string): string => goodLabel?.(good) ?? fallback;
  const localizedGood = (entry: { readonly good: number; readonly id: string }): string =>
    goodLabelOf(entry.good, goodNames[entry.id as keyof Messages['goods']] ?? entry.id);
  const actionLabel = (action: DebugAction): string => copy.actions[action.id];
  const creatureLabel = (preset: CreaturePreset): string =>
    copy.creaturesCatalog[preset.id as keyof typeof copy.creaturesCatalog] ?? preset.id;
  const animalLabel = (entry: AnimalEntry): string =>
    copy.wildlifeCatalog[entry.tribe as keyof typeof copy.wildlifeCatalog] ?? entry.id.replace(/_/g, ' ');
  const playerName = (player: number): string => messages.animation.playerColors[player] ?? String(player);

  return {
    good: localizedGood,
    creature: creatureLabel,
    animal: animalLabel,
    action: actionLabel,
    player: playerName,
  };
}
