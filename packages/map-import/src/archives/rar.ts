import { createExtractorFromData } from 'node-unrar-js';
import { errorMessage, MapImportError } from '../errors.js';
import type { TreeBuilder } from '../tree.js';
import type { ArchiveEntry } from './entries.js';

/**
 * Unpacks the kept entries of a RAR4 or RAR5 archive with the unrar wasm build, whose binary the caller
 * supplies so the package never reads it from disk. A passworded kept entry, encrypted headers or an
 * archive unrar cannot read are `unsupported-archive`.
 */
export async function unpackRar(
  bytes: Uint8Array,
  builder: TreeBuilder,
  keep: (path: string) => boolean,
  wasmBinary: ArrayBuffer,
): Promise<ArchiveEntry[]> {
  try {
    // `data` must be an ArrayBuffer of exactly the archive, never a view's whole backing buffer.
    const extractor = await createExtractorFromData({ wasmBinary, data: bytes.slice().buffer });
    const { arcHeader, fileHeaders } = extractor.getFileList();
    if (arcHeader.flags.headerEncrypted)
      throw new MapImportError('unsupported-archive', 'rar: encrypted headers');
    const wanted: string[] = [];
    for (const header of fileHeaders) {
      builder.list();
      if (header.flags.directory || !keep(header.name)) continue;
      if (header.flags.encrypted) {
        throw new MapImportError('unsupported-archive', `rar: ${header.name} is passworded`);
      }
      builder.reserve(header.name, header.unpSize);
      wanted.push(header.name);
    }
    if (wanted.length === 0) return [];
    const entries: ArchiveEntry[] = [];
    for (const file of extractor.extract({ files: wanted }).files) {
      if (file.extraction !== undefined) entries.push({ path: file.fileHeader.name, bytes: file.extraction });
    }
    return entries;
  } catch (err) {
    if (err instanceof MapImportError) throw err;
    throw new MapImportError('unsupported-archive', `rar: ${errorMessage(err)}`);
  }
}
