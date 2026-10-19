/** What every central window presents to the panel: a beam entry toggles it, and the registry keeps
 *  one open at a time. */
export interface ToolWindow {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
}
