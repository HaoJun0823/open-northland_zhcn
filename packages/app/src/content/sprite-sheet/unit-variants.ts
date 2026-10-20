import type { UnitVariant } from '@open-northland/data';
import type { ByJobTable, SettlerCharacter } from '@open-northland/render';

/** Keep the source table as the native looks and compose the complete looks of the human forms beside it. */
export function withHumanFormCharacters(
  table: ByJobTable<SettlerCharacter>,
  variants: readonly UnitVariant[],
): ByJobTable<SettlerCharacter> {
  const rules = variants.filter((rule) => rule.form === 'human' && rule.graphicsJobType !== undefined);
  if (rules.length === 0) return table;
  const byJob = { ...table.byJob };
  const byWeaponGood = { ...table.byWeaponGood };
  for (const rule of rules) {
    const source = table.byJob[rule.jobType];
    const replacement = rule.graphicsJobType === undefined ? undefined : table.byJob[rule.graphicsJobType];
    if (source === undefined || replacement === undefined) continue;
    const look: SettlerCharacter = {
      ...replacement,
      paletteJobType: rule.graphicsJobType,
      ...(replacement.variants === undefined
        ? {}
        : {
            variants: replacement.variants.map((variant) => ({
              ...variant,
              paletteJobType: rule.graphicsJobType,
            })),
          }),
    };
    byJob[rule.jobType] = look;
    for (const [good, character] of Object.entries(byWeaponGood)) {
      if (character === source) byWeaponGood[Number(good)] = look;
    }
  }
  return { ...table, human: { ...table, byJob, byWeaponGood } };
}
