import { WEATHER_KINDS } from '../../data/weather/types.js';
import { BLOOD_GROUND_SOURCE } from '../blood/ground-shader.js';
import { DISMANTLE_SOURCE } from '../demolition/dismantle-shader.js';
import { GROUND_WAVE_FILTER_SOURCE } from '../ground-waves/ground-wave-filter.js';
import { DECOR_SHADOW_SOURCE } from '../map-objects/decor-shadow-shader.js';
import { PALETTED_SPRITE_SOURCE } from '../paletted-sprite/shader.js';
import { PRESCALE_RECIPES } from '../pixel-art/page-prescaler.js';
import {
  PRESCALED_SCALERS,
  type PrescaledScaler,
  prescaledScalerOf,
  WORLD_MAGNIFY_MODE_NUMBERS,
  type WorldMagnification,
  worldMagnifyModeNumber,
} from '../pixel-art/registry.js';
import { SHADED_DECOR_SOURCE, SHADED_TERRAIN_SOURCE, TINTED_TERRAIN_SOURCE } from '../terrain/shading.js';
import { WEATHER_GRADE_SOURCE, WEATHER_VEIL_SOURCE } from '../weather/atmosphere.js';
import { ATMOSPHERE_NOISE_BAKE_SOURCE } from '../weather/atmosphere-noise.js';
import { GROUND_REACTIONS_SOURCE } from '../weather/ground-reactions.js';
import { precipitationSource } from '../weather/precipitation-shader.js';
import { WORLD_BATCH_MAX_TEXTURES, worldBatchProgramSource } from '../world-batch/shader.js';
import { DEFAULT_SHADOW_STYLE, type ShadowStyle } from '../world-batch/shadow-style.js';
import type { GlslProgramSource } from './program-source.js';

/**
 * Batch texture limits the world batcher is compiled for: WebGL 2 guarantees 16 units; Pixi halves its
 * batch limit where the sampler if-chain fails to compile at a size, down to 8; desktop GL reports up
 * to 32, where the batcher caps its slots.
 */
const WORLD_BATCH_TEXTURE_LIMITS: readonly number[] = [8, 16, WORLD_BATCH_MAX_TEXTURES];

/** The programs a world may draw with whatever its settings; map content and events decide whether it does. */
function unconditionalPrograms(): readonly GlslProgramSource[] {
  return [
    PALETTED_SPRITE_SOURCE,
    DISMANTLE_SOURCE,
    DECOR_SHADOW_SOURCE,
    SHADED_TERRAIN_SOURCE,
    SHADED_DECOR_SOURCE,
    TINTED_TERRAIN_SOURCE,
  ];
}

/** The sky grade, veil and their noise bake, ground reactions and precipitation the weather setting
 *  turns off. */
function weatherPrograms(): readonly GlslProgramSource[] {
  return [
    ATMOSPHERE_NOISE_BAKE_SOURCE,
    WEATHER_GRADE_SOURCE,
    WEATHER_VEIL_SOURCE,
    GROUND_REACTIONS_SOURCE,
    ...WEATHER_KINDS.map((kind) => precipitationSource(kind)),
  ];
}

/**
 * Every GL program the game compiles, in every variant its settings can select, so a check can read
 * or compile the whole set without a renderer. A program whose GLSL is generated lists one entry per
 * generated variant; a new program or variant joins this list in the commit that adds it.
 */
export function shaderCatalog(): readonly GlslProgramSource[] {
  const entries: GlslProgramSource[] = [];
  for (const maxTextures of WORLD_BATCH_TEXTURE_LIMITS) {
    for (const mode of WORLD_MAGNIFY_MODE_NUMBERS) {
      for (const shadow of [null, DEFAULT_SHADOW_STYLE]) {
        entries.push(worldBatchProgramSource(maxTextures, mode, shadow));
      }
    }
  }
  entries.push(
    ...PRESCALED_SCALERS.flatMap((scaler) => prescalePrograms(scaler)),
    ...unconditionalPrograms(),
    BLOOD_GROUND_SOURCE,
    GROUND_WAVE_FILTER_SOURCE,
    ...weatherPrograms(),
  );
  return entries;
}

/** The programs a prescaled scaler redraws its pages with. */
function prescalePrograms(scaler: PrescaledScaler): readonly GlslProgramSource[] {
  return PRESCALE_RECIPES[scaler].map((pass) => pass.program);
}

/** The settings that decide which programs a world can draw with. */
export interface ShaderSelection {
  readonly magnification: WorldMagnification;
  readonly shadow: ShadowStyle | null;
  readonly weather: boolean;
  /** Blood marks on the ground. */
  readonly blood: boolean;
  /** The shore-wave filter, which only environment motion draws. */
  readonly groundWaves: boolean;
}

/** What a world can draw with: the one batch variant for the device's batch limit and the player's
 *  settings, and every other program those settings leave on. */
export function bootShaderPrograms(
  maxBatchTextures: number,
  selection: ShaderSelection,
): readonly GlslProgramSource[] {
  const slots = Math.min(maxBatchTextures, WORLD_BATCH_MAX_TEXTURES);
  const prescaled = selection.magnification === 'off' ? null : prescaledScalerOf(selection.magnification);
  return [
    worldBatchProgramSource(slots, worldMagnifyModeNumber(selection.magnification), selection.shadow),
    ...(prescaled === null ? [] : prescalePrograms(prescaled)),
    ...unconditionalPrograms(),
    ...(selection.blood ? [BLOOD_GROUND_SOURCE] : []),
    ...(selection.groundWaves ? [GROUND_WAVE_FILTER_SOURCE] : []),
    ...(selection.weather ? weatherPrograms() : []),
  ];
}
