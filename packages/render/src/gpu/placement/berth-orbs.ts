import { Graphics } from 'pixi.js';

/**
 * The mark of a ship's berth under the dock cursor: a small glowing sphere hovering over the shore point
 * the ship's door will open on, with its shadow on the ground beneath, and a faint ring on the water
 * where the hull will lie. The project's own look, tuned by eye; the original shows no such mark.
 */

/** How high the sphere floats over its ground point, in world px. */
const FLOAT = 24;
const SHADOW = { color: 0x000000, alpha: 0.35, rx: 13, ry: 6 } as const;
/** The glow around the sphere: wide and faint, then tight and brighter. */
const HALO: readonly { readonly radius: number; readonly alpha: number }[] = [
  { radius: 26, alpha: 0.14 },
  { radius: 18, alpha: 0.26 },
];
const HALO_COLOR = 0xbff3ff;
const BODY = { color: 0x3fb6e0, radius: 11 } as const;
/** The sphere's lit side, offset up and left toward the scene light, then its specular glint. */
const SHADE = { color: 0x8fe0f7, radius: 7.5, dx: -2.2, dy: -2.2 } as const;
const GLINT = { color: 0xffffff, radius: 3, dx: -4.5, dy: -4.8, alpha: 0.95 } as const;
const RIM = { color: 0x0e4b63, width: 1.6, alpha: 0.85 } as const;
/** The thread from the sphere down to its ground point, so it reads as standing over that spot. */
const TETHER = { color: 0xe8fbff, width: 1.5, alpha: 0.6 } as const;

/** The ring where a hull will lie: about the length and beam of a drawn ship on the water. */
const HULL_RING = { rx: 64, ry: 28, color: 0xbff3ff, width: 2, alpha: 0.55, fill: 0.08 } as const;

/** A berth's two screen points, lifted onto the ground: the door's on the shore, the hull's on the water. */
export interface BerthPoints {
  readonly door: { readonly x: number; readonly y: number };
  readonly hull: { readonly x: number; readonly y: number };
}

/** Draw one berth orb at ground point (`x`, `y`) into `g`. */
function drawBerthOrb(g: Graphics, x: number, y: number): Graphics {
  const cy = y - FLOAT;
  g.ellipse(x, y, SHADOW.rx, SHADOW.ry).fill({ color: SHADOW.color, alpha: SHADOW.alpha });
  g.moveTo(x, y)
    .lineTo(x, cy + BODY.radius)
    .stroke({ color: TETHER.color, width: TETHER.width, alpha: TETHER.alpha });
  for (const halo of HALO) g.circle(x, cy, halo.radius).fill({ color: HALO_COLOR, alpha: halo.alpha });
  g.circle(x, cy, BODY.radius)
    .fill(BODY.color)
    .stroke({ color: RIM.color, width: RIM.width, alpha: RIM.alpha });
  g.circle(x + SHADE.dx, cy + SHADE.dy, SHADE.radius).fill(SHADE.color);
  g.circle(x + GLINT.dx, cy + GLINT.dy, GLINT.radius).fill({ color: GLINT.color, alpha: GLINT.alpha });
  return g;
}

export function mintBerthOrbs(berths: readonly BerthPoints[]): Graphics {
  const g = new Graphics();
  // The rings lie on the water under every orb.
  for (const { hull } of berths) {
    g.ellipse(hull.x, hull.y, HULL_RING.rx, HULL_RING.ry)
      .fill({ color: HULL_RING.color, alpha: HULL_RING.fill })
      .stroke({ color: HULL_RING.color, width: HULL_RING.width, alpha: HULL_RING.alpha });
  }
  // Back to front, so a nearer orb covers the one behind it.
  for (const { door } of [...berths].sort((a, b) => a.door.y - b.door.y)) drawBerthOrb(g, door.x, door.y);
  return g;
}
