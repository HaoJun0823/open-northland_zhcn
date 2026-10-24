// @vitest-environment jsdom
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createTooltip } from '../../src/view/tooltip.js';

/** jsdom lays nothing out, so the chip's box comes from these getters and each read is counted. */
const CHIP_BOX = { width: 120, height: 24 };
const reads = { count: 0 };
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get: () => {
    reads.count++;
    return CHIP_BOX.width;
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get: () => CHIP_BOX.height,
});

afterEach(() => {
  document.body.replaceChildren();
  reads.count = 0;
});

describe('tooltip chip measurement', () => {
  it('measures once per text while the chip follows the cursor', () => {
    const tip = createTooltip();
    tip.show(10, 10, 'Drwal');
    tip.show(20, 30, 'Drwal');
    tip.show(40, 50, 'Drwal');
    expect(reads.count).toBe(1);
    tip.show(40, 50, 'Kamieniarz');
    expect(reads.count).toBe(2);
    tip.destroy();
  });

  it('measures again after the chip was hidden and shown with the same text', () => {
    const tip = createTooltip();
    tip.show(10, 10, 'Drwal');
    tip.hide();
    tip.show(10, 10, 'Drwal');
    expect(reads.count).toBe(2);
    tip.destroy();
  });

  it('writes a position only when it changes', () => {
    const tip = createTooltip();
    tip.show(10, 10, 'Drwal');
    const el = document.body.lastElementChild;
    if (!(el instanceof HTMLElement)) throw new Error('chip not attached');
    const { left, top } = el.style;
    tip.show(10, 10, 'Drwal');
    expect(el.style.left).toBe(left);
    expect(el.style.top).toBe(top);
    tip.show(300, 10, 'Drwal');
    expect(el.style.left).not.toBe(left);
    tip.destroy();
  });
});

afterAll(() => {
  if (originalWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalWidth);
  if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalHeight);
});
