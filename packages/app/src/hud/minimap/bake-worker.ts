import {
  createCachedMinimapBake,
  type MinimapBakeReply,
  type MinimapBakeRequest,
  type MinimapGroundBake,
} from './bake.js';

const scope = globalThis as unknown as Pick<Worker, 'addEventListener' | 'postMessage'>;

let bake: MinimapGroundBake | undefined;

scope.addEventListener('message', (event: MessageEvent<MinimapBakeRequest>) => {
  const request = event.data;
  if (request.kind === 'scene') {
    bake = createCachedMinimapBake(request.scene);
    return;
  }
  // The client posts the scene before its first bake, and a worker reads its messages in order.
  if (bake === undefined) return;
  const { objects, changes } = request;
  const picture = bake(request.width, request.height, request.mode, {
    ...(objects !== undefined ? { objects } : {}),
    ...(changes !== undefined ? { changes } : {}),
  });
  const reply: MinimapBakeReply = { id: request.id, ...picture };
  scope.postMessage(reply, [picture.rgba.buffer]);
});
