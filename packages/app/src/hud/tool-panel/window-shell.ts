/** The modifier keys a click carried. */
export interface ClickModifiers {
  /** Ctrl or Cmd was held. */
  readonly bigStep: boolean;
}

/** What every central window presents to the panel: a beam entry toggles it, and the panel probes it
 *  for pointer input. */
export interface ToolWindow {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
  /** True when the point is over the open window (the HUD claims it before world picking). */
  claims(x: number, y: number): boolean;
  /** Route a canvas-space click; true when this window consumed it. */
  handleClick(x: number, y: number, mods?: ClickModifiers): boolean;
}
