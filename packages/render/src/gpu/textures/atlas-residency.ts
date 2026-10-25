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
 * towns draws (about 1.2 GB).
 */
export const ATLAS_RESIDENCY_BUDGET_BYTES = 1024 * 1024 * 1024;

const UPLOAD_METHOD = 'atlas-page';
const RGBA_BYTES = 4;
const RG_BYTES = 2;

/** The part of a page the policy reads: when a draw last bound it, in Pixi's GC clock. */
export interface ResidentPage {
  readonly _gcLastUsed: number;
}

/**
 * Which uploaded pages to unload so the resident bytes fit a budget: the least recently drawn first,
 * never one drawn in the frame that uploads `page` (bound at the same GC time or later).
 */
export class AtlasResidency<Page extends ResidentPage> {
  private readonly bytesOf = new Map<Page, number>();
  private total = 0;

  constructor(private readonly budget: number) {}

  get residentBytes(): number {
    return this.total;
  }

  /** Records `page` as uploaded and answers the pages to unload, oldest first. */
  admit(page: Page, bytes: number): Page[] {
    if (!this.bytesOf.has(page)) {
      this.bytesOf.set(page, bytes);
      this.total += bytes;
    }
    if (this.total <= this.budget) return [];
    const now = page._gcLastUsed;
    const victims: Page[] = [];
    let total = this.total;
    const oldest = [...this.bytesOf.keys()]
      .filter((other) => other._gcLastUsed < now)
      .sort((a, b) => a._gcLastUsed - b._gcLastUsed);
    for (const victim of oldest) {
      if (total <= this.budget) break;
      victims.push(victim);
      total -= this.bytesOf.get(victim) ?? 0;
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

const pageBytes = (source: TextureSource): number =>
  source.pixelWidth * source.pixelHeight * (source.format === 'rg8unorm' ? RG_BYTES : RGBA_BYTES);

/** Pixi's image upload, then the budget: a newly resident page may unload the oldest others. */
const ATLAS_PAGE_UPLOADER: GLTextureUploader = {
  id: UPLOAD_METHOD,
  upload(source, glTexture, gl, webGLVersion, targetOverride, forceAllocation) {
    glUploadImageResource.upload(source, glTexture, gl, webGLVersion, targetOverride, forceAllocation);
    const fresh = !residentPages.has(source);
    if (fresh) {
      residentPages.add(source);
      source.once('unload', () => {
        residentPages.delete(source);
        residency.forget(source);
      });
    }
    for (const victim of residency.admit(source, pageBytes(source))) victim.unload();
  },
};

const residentPages = new WeakSet<TextureSource>();

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
