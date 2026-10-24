import { MapImportError } from '@open-northland/map-import/input';
import { type DesktopLocalMapInput, desktopMaps } from '../../view/platform/desktop-bridge.js';
import { LocalImportError } from './client.js';
import { checkedLocalInput, type LocalMapInput } from './input.js';

export function localInputFromDesktop(input: DesktopLocalMapInput): LocalMapInput {
  return checkedLocalInput(
    input.kind === 'archive'
      ? { kind: 'archive', name: input.name, file: new Blob([new Uint8Array(input.bytes)]) }
      : {
          kind: 'folder',
          name: input.name,
          files: input.files.map((file) => ({
            path: file.path,
            file: new Blob([new Uint8Array(file.bytes)]),
          })),
        },
  );
}

export async function localInputToDesktop(raw: LocalMapInput): Promise<DesktopLocalMapInput> {
  const input = checkedLocalInput(raw);
  return input.kind === 'archive'
    ? { kind: 'archive', name: input.name, bytes: new Uint8Array(await input.file.arrayBuffer()) }
    : {
        kind: 'folder',
        name: input.name,
        files: await Promise.all(
          input.files.map(async (file) => ({
            path: file.path,
            bytes: new Uint8Array(await file.file.arrayBuffer()),
          })),
        ),
      };
}

export async function pickDesktopMap(
  kind: 'archive' | 'folder' | File,
  signal: AbortSignal,
): Promise<LocalMapInput> {
  const maps = desktopMaps();
  if (maps === null) throw new Error('Desktop picker unavailable');
  signal.throwIfAborted();
  const cancel = (): void => {
    void maps.cancelPick();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await (typeof kind === 'string' ? maps.pick(kind) : maps.drop(kind));
    signal.throwIfAborted();
    if (result.kind === 'cancelled') throw new DOMException('Picker cancelled', 'AbortError');
    if (result.kind === 'failed') {
      if (result.failure === 'read-failed') throw new LocalImportError('read-failed', result.message);
      throw new MapImportError(result.failure, result.message);
    }
    return localInputFromDesktop(result.input);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
