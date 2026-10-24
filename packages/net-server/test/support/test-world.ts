import type { GameSession } from '@open-northland/lockstep';
import { restoreSimulation, type SaveGame, Simulation } from '@open-northland/sim';
import { testContent } from '../../../sim/test/fixtures/content.js';

/** The world a session descriptor names, on the shared test content. */
export async function buildTestWorld(session: GameSession): Promise<Simulation> {
  return new Simulation({ seed: session.seed, content: testContent() });
}

/** A served snapshot restored on the shared test content. */
export async function restoreTestWorld(_session: GameSession, save: SaveGame): Promise<Simulation> {
  return restoreSimulation(save, { content: testContent() });
}
