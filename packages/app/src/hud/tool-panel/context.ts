import type { UiCue } from '@open-northland/audio';
import type { UiString } from '../../content/gui/gfx.js';

/** What the tool panel's controllers need from the mounted panel. */
export interface PanelContext {
  /** Prefer the decoded UI string for `(table, id)`, else the pinned fallback label. */
  readonly uiString: UiString;
  /** The GUI click a pressed button confirms with and a cancelled hold fails with. */
  readonly cue: (cue: UiCue) => void;
}
