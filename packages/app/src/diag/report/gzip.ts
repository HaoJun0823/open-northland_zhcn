/** Reports travel as gzipped JSON; `CompressionStream` is in every browser the game supports. */

export type GzipBytes = Uint8Array<ArrayBuffer>;

export function canGzip(): boolean {
  return typeof CompressionStream === 'function';
}

export async function gzipText(text: string): Promise<GzipBytes> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  // A failed write errors the readable side, which the read below reports.
  writer.write(new TextEncoder().encode(text)).catch(() => undefined);
  writer.close().catch(() => undefined);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export function gzipJson(value: unknown): Promise<GzipBytes> {
  return gzipText(JSON.stringify(value));
}

/** The gzipped size of `value` as JSON; 0 when this browser cannot compress. */
export async function gzipSize(value: unknown): Promise<number> {
  if (!canGzip()) return 0;
  return (await gzipJson(value)).byteLength;
}
