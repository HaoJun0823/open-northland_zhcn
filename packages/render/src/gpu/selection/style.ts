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

/** A one-time acknowledgement on an order's target: an order lifts it towards white, an attack towards
 *  red, an assignment to a building towards green. A presentation addition, not taken from the original. */
export type TargetFlashTone = 'order' | 'attack' | 'assign';

export interface TargetFlash {
  readonly tone: TargetFlashTone;
  /** 0 when the order was given, 1 when the flash has played out. */
  readonly progress: number;
}

/** The colour each lift tone moves towards, by tone code: white (the selection pulse's too), then each
 *  flash tone's. The sprite shaders index this array, so a code is its position here. */
const LIFT_COLOURS = ['vec3(1.0)', 'vec3(1.0, 0.5, 0.42)', 'vec3(0.6, 1.0, 0.5)'] as const;
export const LIFT_TONE_CODE: Readonly<Record<TargetFlashTone, number>> = { order: 0, attack: 1, assign: 2 };
/** The GLSL declaration of {@link LIFT_COLOURS} as `LIFT_COLOURS`, for both sprite shaders. */
export const LIFT_COLOURS_GLSL = `const int LIFT_TONES = ${LIFT_COLOURS.length};
const vec3 LIFT_COLOURS[LIFT_TONES] = vec3[LIFT_TONES](${LIFT_COLOURS.join(', ')});`;

/** Artistic choice: one short, faint swell and fade, above the selection pulse so it reads as the
 *  order's reply without covering the sprite. */
const TARGET_FLASH_PEAK = 0.15;

export function targetFlashLight(progress: number): number {
  return TARGET_FLASH_PEAK * Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));
}
