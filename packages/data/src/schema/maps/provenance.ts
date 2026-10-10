import { z } from 'zod';

/** Where a map's files came from: the mod, a player's own folder, the culturesnation catalogue, or a
 *  loose game folder. A source-location classification, not a redistribution licence. */
export const MapProvenance = z.strictObject({
  kind: z.enum(['mod', 'user', 'catalog', 'unknown']),
  /** The folder relative to its source root (the mod tree or the archive), never a machine path. */
  folder: z
    .string()
    .min(1)
    .refine(
      (value) =>
        !value.startsWith('/') &&
        !value.includes('\\') &&
        !value.includes(':') &&
        value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
      { message: 'expected a relative map folder' },
    ),
});
export type MapProvenance = z.infer<typeof MapProvenance>;
