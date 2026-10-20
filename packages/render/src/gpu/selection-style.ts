export const SELECTION_STYLES = ['outline', 'pulse', 'ring-white', 'ring-green'] as const;
export type SelectionStyle = (typeof SELECTION_STYLES)[number];
export const DEFAULT_SELECTION_STYLE: SelectionStyle = 'outline';

export function parseSelectionStyle(value: unknown): SelectionStyle {
  return SELECTION_STYLES.find((style) => style === value) ?? DEFAULT_SELECTION_STYLE;
}

/** Artistic choice: a slow, shallow lift towards white; never darkens or hides the selected object. */
export function selectionLight(timeSeconds: number): number {
  return 0.07 + 0.025 * Math.sin((timeSeconds * Math.PI * 2) / 1.8);
}

/** A one-time acknowledgement on an order's target: a claim lifts it towards white, an attack towards
 *  red. A presentation addition, not taken from the original. */
export type TargetFlashTone = 'claim' | 'attack';

export interface TargetFlash {
  readonly tone: TargetFlashTone;
  /** 0 when the order was given, 1 when the flash has played out. */
  readonly progress: number;
}

/** The red an attack's target lifts towards, as a GLSL `vec3` for both sprite shaders. */
export const ALERT_LIFT_GLSL = 'vec3(1.0, 0.5, 0.42)';

/** Artistic choice: one swell and fade, well above the selection pulse so it reads as the order's reply. */
const TARGET_FLASH_PEAK = 0.4;

export function targetFlashLight(progress: number): number {
  return TARGET_FLASH_PEAK * Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));
}
