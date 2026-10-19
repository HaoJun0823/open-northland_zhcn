import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  clientWidth = 0;
  clientHeight = 0;
  isConnected = true;
  constructor(width: number, height: number) {
    this.resize(width, height);
  }
  resize(width: number, height: number): void {
    this.clientWidth = width;
    this.clientHeight = height;
  }
}

/** The one observer the module makes: what it observes, and a way to report entries to it. */
const observed = new Set<unknown>();
let report: (targets: readonly FakeElement[]) => void = () => undefined;

class FakeResizeObserver {
  constructor(callback: (entries: { target: unknown }[]) => void) {
    report = (targets) => callback(targets.map((target) => ({ target })));
  }
  observe(target: unknown): void {
    observed.add(target);
  }
  unobserve(target: unknown): void {
    observed.delete(target);
  }
}

async function loadPlaneSize(): Promise<typeof import('../src/hud/dom/plane-size.js')> {
  vi.resetModules();
  return import('../src/hud/dom/plane-size.js');
}

async function loadWindow(): Promise<typeof import('../src/hud/dom/window.js')> {
  vi.resetModules();
  return import('../src/hud/dom/window.js');
}

const plane = (width: number, height: number): HTMLElement =>
  new FakeElement(width, height) as unknown as HTMLElement;

describe('plane size', () => {
  beforeEach(() => {
    observed.clear();
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('measures on the first read and keeps that box until the observer reports another', async () => {
    const { planeSize } = await loadPlaneSize();
    const element = plane(1440, 900);
    expect(planeSize(element)).toEqual({ width: 1440, height: 900 });
    expect(observed.has(element)).toBe(true);
    (element as unknown as FakeElement).resize(1152, 720);
    // No read of the box between reports: a frame's read never lays out the page.
    expect(planeSize(element)).toEqual({ width: 1440, height: 900 });
    report([element as unknown as FakeElement]);
    expect(planeSize(element)).toEqual({ width: 1152, height: 720 });
  });

  it("tells each listener the new box from the observer's report, until it stops", async () => {
    const { onPlaneResize, planeSize } = await loadPlaneSize();
    const element = plane(1440, 900);
    const sizes: unknown[] = [];
    const stop = onPlaneResize(element, (size) => sizes.push(size));
    (element as unknown as FakeElement).resize(1920, 1080);
    report([element as unknown as FakeElement]);
    expect(sizes).toEqual([{ width: 1920, height: 1080 }]);
    // The listener reads the box it was told, as every other reader does from then on.
    expect(planeSize(element)).toEqual({ width: 1920, height: 1080 });
    stop();
    report([element as unknown as FakeElement]);
    expect(sizes).toHaveLength(1);
  });

  it('forgets a plane taken off the page, and measures it afresh if it is asked for again', async () => {
    const { onPlaneResize, planeSize } = await loadPlaneSize();
    const element = plane(1440, 900);
    const listener = vi.fn();
    onPlaneResize(element, listener);
    const fake = element as unknown as FakeElement;
    fake.isConnected = false;
    fake.resize(0, 0);
    report([fake]);
    expect(listener).not.toHaveBeenCalled();
    expect(observed.has(element)).toBe(false);
    fake.isConnected = true;
    fake.resize(800, 600);
    expect(planeSize(element)).toEqual({ width: 800, height: 600 });
  });

  it('reads the box each time on a page without the observer', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { onPlaneResize, planeSize } = await loadPlaneSize();
    const element = plane(1440, 900);
    expect(planeSize(element)).toEqual({ width: 1440, height: 900 });
    (element as unknown as FakeElement).resize(1024, 768);
    expect(planeSize(element)).toEqual({ width: 1024, height: 768 });
    expect(() => onPlaneResize(element, () => undefined)()).not.toThrow();
  });

  it("places a central window from the observer's report, and tells its owner it moved once", async () => {
    const { centralWindowPlacer } = await loadWindow();
    const element = plane(1440, 900);
    const places: [number, number][] = [];
    const window = {
      isOpen: () => true,
      element: { isConnected: true, style: {} },
      place: (x: number, y: number) => places.push([x, y]),
    } as unknown as import('../src/hud/dom/window.js').HudWindow;
    const place = centralWindowPlacer(window, element, 600);
    expect(place()).toBe(true);
    expect(place()).toBe(false);
    (element as unknown as FakeElement).resize(1920, 1080);
    report([element as unknown as FakeElement]);
    // Placed in the report, before the frame paints, not at the owner's next frame.
    expect(places).toHaveLength(2);
    expect(place()).toBe(true);
    expect(place()).toBe(false);
  });
});
