import { BatchTextureArray, type Texture, type TextureSource } from 'pixi.js';

/** A quad as a table sees it: the texture its sprite draws. */
export interface TableQuad {
  readonly sprite: { readonly texture: Texture };
}

/**
 * One still-mesh draw's texture list: the pages its quads sample, contiguous from slot 0. Consecutive
 * draws of a band share a table until a quad's page does not fit it, which is where Pixi would break a
 * batch for its textures too.
 */
export class DrawTable extends BatchTextureArray {
  /** @param joined told of each page the table takes on. */
  constructor(
    private readonly maxPages: number,
    private readonly joined: (source: TextureSource) => void,
  ) {
    super();
  }

  /** Whether `quads` fit together: their pages not listed yet fit the table's free slots. A destroyed
   *  page fits no table. */
  fits(quads: readonly TableQuad[]): boolean {
    let added = 0;
    for (let q = 0; q < quads.length; q++) {
      const quad = quads[q];
      if (quad === undefined) continue;
      const texture = quad.sprite.texture;
      const source: TextureSource | null = texture.source;
      if (source === null || source.destroyed) return false;
      if (typeof this.ids[source.uid] === 'number' || listedBefore(quads, q, source)) continue;
      added++;
    }
    return this.count + added <= this.maxPages;
  }

  /** The slot of the page `quad`'s sprite draws, the page joining the table; null when it does not fit. */
  join(quad: TableQuad): number | null {
    const source = quad.sprite.texture.source;
    let slot: number | null | undefined = this.ids[source.uid];
    if (typeof slot !== 'number') {
      if (this.count >= this.maxPages) return null;
      slot = this.count++;
      this.ids[source.uid] = slot;
      this.textures[slot] = source;
      this.joined(source);
    }
    return slot;
  }
}

/** Whether a quad before `q` draws from `source`, which then needs no slot of its own. */
function listedBefore(quads: readonly TableQuad[], q: number, source: TextureSource): boolean {
  for (let p = 0; p < q; p++) if (quads[p]?.sprite.texture.source === source) return true;
  return false;
}
