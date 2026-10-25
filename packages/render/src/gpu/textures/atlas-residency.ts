import {
  ExtensionType,
  extensions,
  type GLTextureUploader,
  glUploadImageResource,
  type TextureSource,
} from 'pixi.js';

/**
 * GPU bytes of atlas pages kept resident before the least recently drawn ones are unloaded. Pixi's
 * own GC would unload any page no draw used for a minute, and the next draw would upload the whole page
 * again in one frame. Approximation: a fixed budget, since WebGL tells nothing of the device's memory;
 * it holds the pages a late `magiczny_las` view draws (about 600 MB), not every page a tour of all its
 * towns draws (about 1045 MB).
 */
export const ATLAS_RESIDENCY_BUDGET_BYTES = 1024 * 1024 * 1024;

/**
 * A page drawn this recently is never unloaded, so every view a frame renders (the stage, portrait
 * insets, map views, prescale passes, each its own `render()`) keeps its pages even when together
 * they exceed the budget. Approximation: one second spans many frames at any playable rate.
 */
export const RECENTLY_DRAWN_MS = 1000;

const UPLOAD_METHOD = 'atlas-page';
const RGBA_BYTES = 4;
const RG_BYTES = 2;

/**
 * The part of a page the policy reads: when a draw last bound it, on the `performance.now()` clock.
 * Pixi's GC stamps `_gcLastUsed` on every bind (private in Pixi 8.22; re-verify on a Pixi bump).
 */
export interface ResidentPage {
  readonly _gcLastUsed: number;
}

/** The uploaded pages' bytes, and which of them to unload so the total fits a budget. */
export class AtlasResidency<Page extends ResidentPage> {
  private readonly bytesOf = new Map<Page, number>();
  private total = 0;

  constructor(private readonly budget: number) {}

  get residentBytes(): number {
    return this.total;
  }

  /** Records `page` as uploaded; true when the resident bytes now pass the budget. */
  admit(page: Page, bytes: number): boolean {
    if (!this.bytesOf.has(page)) {
      this.bytesOf.set(page, bytes);
      this.total += bytes;
    }
    return this.total > this.budget;
  }

  /** The pages to unload at time `now`, least recently drawn first, none drawn within
   *  {@link RECENTLY_DRAWN_MS}; fewer than needed when the recent pages alone pass the budget. */
  victims(now: number): Page[] {
    if (this.total <= this.budget) return [];
    const stale = [...this.bytesOf.keys()]
      .filter((page) => page._gcLastUsed < now - RECENTLY_DRAWN_MS)
      .sort((a, b) => a._gcLastUsed - b._gcLastUsed);
    const victims: Page[] = [];
    let total = this.total;
    for (const page of stale) {
      if (total <= this.budget) break;
      victims.push(page);
      total -= this.bytesOf.get(page) ?? 0;
    }
    return victims;
  }

  /** `page` left the GPU. */
  forget(page: Page): void {
    this.total -= this.bytesOf.get(page) ?? 0;
    this.bytesOf.delete(page);
  }
}

const residency = new AtlasResidency<TextureSource>(ATLAS_RESIDENCY_BUDGET_BYTES);
const residentPages = new WeakSet<TextureSource>();
let evictionQueued = false;

const pageBytes = (source: TextureSource): number =>
  source.pixelWidth * source.pixelHeight * (source.format === 'rg8unorm' ? RG_BYTES : RGBA_BYTES);

/**
 * Unloads stale pages once the frame that went over the budget has finished all its renders, never
 * from inside an upload, where a page bound later in the same render could go. A page whose GPU copy
 * a lost context already dropped is stale too, so unloading it only corrects the count.
 */
function evictStalePages(): void {
  evictionQueued = false;
  for (const page of residency.victims(performance.now())) page.unload();
}

/** Pixi's image upload, then the budget check. */
const ATLAS_PAGE_UPLOADER: GLTextureUploader = {
  id: UPLOAD_METHOD,
  upload(source, glTexture, gl, webGLVersion, targetOverride, forceAllocation) {
    glUploadImageResource.upload(source, glTexture, gl, webGLVersion, targetOverride, forceAllocation);
    if (!residentPages.has(source)) {
      residentPages.add(source);
      source.once('unload', () => {
        residentPages.delete(source);
        residency.forget(source);
      });
    }
    if (residency.admit(source, pageBytes(source)) && !evictionQueued) {
      evictionQueued = true;
      setTimeout(evictStalePages, 0);
    }
  },
};

let uploaderRegistered = false;

/** Teach WebGL renderers the atlas page upload; a renderer copies its uploaders when it is built, so
 *  this runs before any is. */
export function registerAtlasPageUploader(): void {
  if (uploaderRegistered) return;
  uploaderRegistered = true;
  extensions.add({ type: ExtensionType.TextureUploaderWebGL, name: UPLOAD_METHOD, ref: ATLAS_PAGE_UPLOADER });
}

/** Moves an atlas page from Pixi's idle GC to the residency budget. */
export function keepAtlasPageResident(source: TextureSource): void {
  source.autoGarbageCollect = false;
  source.uploadMethodId = UPLOAD_METHOD;
}
