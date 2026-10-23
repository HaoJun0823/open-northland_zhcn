/** Vitest setup for the app suite: jsdom lacks `Element.checkVisibility`, which the HUD tip layer calls
 *  on a keyboard focus. Whether jsdom reports `:focus-visible` depends on which files ran before in the
 *  worker, so without the shim a `focus()` in any window with tips throws only in some file orders.
 *  Approximation: visible means connected with no `display: none` ancestor. */
if (typeof Element !== 'undefined' && typeof Element.prototype.checkVisibility !== 'function') {
  Element.prototype.checkVisibility = function (this: Element): boolean {
    if (!this.isConnected) return false;
    for (let node: Element | null = this; node !== null; node = node.parentElement) {
      if (getComputedStyle(node).display === 'none') return false;
    }
    return true;
  };
}
