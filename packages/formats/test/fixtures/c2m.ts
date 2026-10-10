import { ByteWriter } from '../../src/byte-cursor.js';
import { C2M_VERSION } from '../../src/c2m.js';

/** The editor's export root, under which every authored `.c2m` stores its files. */
export const C2M_ROOT = 'currentusermap';

/** Writes a `.c2m` holding `files` (paths relative to {@link C2M_ROOT}, either separator). */
export function encodeC2m(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const names = Object.keys(files).map((path) => `${C2M_ROOT}\\${path.replace(/\//g, '\\')}`);
  const dirs = new Set<string>(['\\']);
  for (const name of names) {
    const parts = name.split('\\');
    for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join('\\')}\\`);
  }
  const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const dirList = [...dirs];
  const blobs = Object.values(files);
  let header = 3 * 4;
  for (const dir of dirList) header += 8 + dir.length;
  for (const name of names) header += 12 + name.length;
  const out = new ByteWriter();
  out.u32(C2M_VERSION);
  out.u32(dirList.length);
  out.u32(names.length);
  dirList.forEach((dir, i) => {
    out.u32(dir.length);
    out.bytes(latin1(dir));
    out.u32(i);
  });
  let offset = header;
  names.forEach((name, i) => {
    const size = blobs[i]?.length ?? 0;
    out.u32(name.length);
    out.bytes(latin1(name));
    out.u32(offset);
    out.u32(size);
    offset += size;
  });
  for (const blob of blobs) out.bytes(blob);
  return out.result();
}
