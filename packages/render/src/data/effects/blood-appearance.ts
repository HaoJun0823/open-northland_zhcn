import type { components } from '@open-northland/sim';

export type BloodPalette = 0 | 1 | 2 | 3;
export interface BloodAppearance {
  readonly palette: BloodPalette;
  readonly volume: number;
}

/** Authored presentation: red humans, dark red werewolves, slate-blue weresnakes and burgundy dragons.
 * The form tells the dragon from the Byzantine wooden spearman in his human form. */
const CREATURE_BLOOD: readonly (BloodAppearance & Partial<components.SettlerIdentity>)[] = [
  { tribe: 5, palette: 2, volume: 1 },
  { tribe: 6, palette: 1, volume: 1.5 },
  { tribe: 3, jobType: 32, humanForm: false, palette: 3, volume: 2.5 },
];
const HUMAN_BLOOD: BloodAppearance = { palette: 0, volume: 1 };

export function bloodAppearance(identity: components.SettlerIdentity | undefined): BloodAppearance {
  if (identity === undefined) return HUMAN_BLOOD;
  return (
    CREATURE_BLOOD.find(
      (rule) =>
        rule.tribe === identity.tribe &&
        (rule.jobType === undefined || rule.jobType === identity.jobType) &&
        (rule.humanForm === undefined || rule.humanForm === (identity.humanForm === true)),
    ) ?? HUMAN_BLOOD
  );
}

/** Linear transforms shared by textures and procedural stains. Neutral adds an achromatic
 * fraction of the original red intensity, keeping the blue muted even along thin edges. */
export const BLOOD_PALETTES = [
  { swap: false, rgb: [1, 1, 1], neutral: 0 },
  { swap: false, rgb: [0.7, 0.8, 0.85], neutral: 0 },
  { swap: true, rgb: [0.55, 1.7, 0.34], neutral: 0.2 },
  { swap: false, rgb: [0.65, 0.8, 2.1], neutral: 0 },
] as const;
