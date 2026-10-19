import { afterEach, expect, it, vi } from 'vitest';
import * as toolPanel from '../src/hud/tool-panel/index.js';
import { type GameToolPanelDeps, mountGameToolPanel } from '../src/view/game-tool-panel.js';

afterEach(() => {
  vi.restoreAllMocks();
});

it("hands the map's briefing picture URLs to the mission book", async () => {
  const mount = vi
    .spyOn(toolPanel, 'mountToolPanel')
    .mockResolvedValue({} as Awaited<ReturnType<typeof toolPanel.mountToolPanel>>);
  const missionPictureUrl = (file: string): string => `blob:${file}`;
  await mountGameToolPanel({ missionPictureUrl } as unknown as GameToolPanelDeps);
  expect(mount.mock.calls[0]?.[0].missionPictureUrl).toBe(missionPictureUrl);
});
