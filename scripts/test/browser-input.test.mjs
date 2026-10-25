import assert from 'node:assert/strict';
import test from 'node:test';
import { pointerPath, worldArea } from '../browser/input.mjs';

test('the moving pointer stays inside the world area at the asked mean speed', () => {
  const area = worldArea({ width: 1920, height: 1080 });
  const path = pointerPath(area, 60);
  const seconds = 30;
  const steps = 3000;
  let length = 0;
  let previous = path(0);
  for (let i = 1; i <= steps; i++) {
    const point = path((i * seconds) / steps);
    assert.ok(point.x > area.left && point.x < area.right && point.y > area.top && point.y < area.bottom);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  // The curve's speed varies along it; over a stretch of it the mean stays near the asked one.
  assert.ok(length / seconds > 30 && length / seconds < 90, `${length / seconds} px/s`);
});
