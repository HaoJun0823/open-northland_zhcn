// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { LocalImportError } from '../../src/content/local-import/client.js';
import { droppedLocalInput, localFilePicker, pickedFolder } from '../../src/content/local-import/picker.js';
import { MapStorageFullError } from '../../src/content/map-source/installed.js';
import { localImportMessage } from '../../src/entries/main-menu/catalogue/local-import.js';
import { messages } from '../../src/i18n/index.js';

function picked(path: string): File {
  const file = new File(['map'], path.split('/').at(-1) ?? 'map.dat');
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('local map input', () => {
  it('preserves paths below the selected folder and excludes unrelated files', () => {
    const map = picked('Paczka/Wyspa/map.dat');
    const folder = pickedFolder([map, picked('Paczka/readme.txt')]);
    expect(folder).toEqual({ kind: 'folder', name: 'Paczka', files: [{ path: 'Wyspa/map.dat', file: map }] });
  });

  it('resets the file input so the same file can be selected again', () => {
    const receive = vi.fn();
    const failure = vi.fn();
    const input = localFilePicker(false, receive, failure);
    Object.defineProperty(input, 'files', { value: [new File(['archive'], 'map.zip')] });
    input.dispatchEvent(new Event('change'));
    input.dispatchEvent(new Event('change'));
    expect(receive).toHaveBeenCalledTimes(2);
    expect(failure).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('reads every batch of a dropped directory and obeys cancellation', async () => {
    const file = new File(['map'], 'map.dat');
    const entry = {
      name: 'map.dat',
      isFile: true,
      isDirectory: false,
      file: (resolve: (file: File) => void) => resolve(file),
    };
    let batches = 0;
    const directory = {
      name: 'folder',
      isDirectory: true,
      isFile: false,
      createReader: () => ({
        readEntries: (resolve: (entries: unknown[]) => void) => resolve(batches++ === 0 ? [entry] : []),
      }),
    };
    const transfer = {
      items: [{ kind: 'file', webkitGetAsEntry: () => directory }],
    } as unknown as DataTransfer;
    expect(await droppedLocalInput(transfer, new AbortController().signal)).toEqual({
      kind: 'folder',
      name: 'folder',
      files: [{ path: 'map.dat', file }],
    });
    const abort = new AbortController();
    abort.abort();
    await expect(droppedLocalInput(transfer, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(batches).toBe(2);
  });

  it('maps typed failures and quota failures to player-facing messages', () => {
    const text = messages().mapCatalogue.localImport;
    expect(localImportMessage(new LocalImportError('no-map', 'decoder details')).text).toBe(text.noMap);
    expect(localImportMessage(new MapStorageFullError(100, 0))).toEqual({ text: text.full, full: true });
    expect(localImportMessage(new DOMException('internal quota details', 'QuotaExceededError'))).toEqual({
      text: text.full,
      full: true,
    });
  });
});
