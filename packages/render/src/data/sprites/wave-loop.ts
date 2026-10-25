/** A flag's wave frames in playback order; a single frame is a still. */
export type WaveLoop<T> = readonly [T, ...T[]];

/**
 * Looping landscape flags share the scene animation clock: one frame per simulation tick.
 * Original behavior, not yet compared against a running original; an eight-frame wave takes
 * about 0.67 s at 12 ticks/s.
 */
export const FLAG_WAVE_TICKS_PER_FRAME = 1;

export function waveFrameAt<T>(loop: WaveLoop<T>, tick: number): T {
  return loop[Math.floor(tick / FLAG_WAVE_TICKS_PER_FRAME) % loop.length] ?? loop[0];
}
