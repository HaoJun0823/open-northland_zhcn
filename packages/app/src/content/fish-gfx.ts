/** The original's fish drawing uses the special `fishes` palette and selects one of the first 18
 *  directional bobs from this BMD for every fish in the swarm. */
export const FISH_ATLAS = 'ls_fishes.fishes';
export const FISH_BOBS: readonly number[] = Array.from({ length: 18 }, (_, bob) => bob);
