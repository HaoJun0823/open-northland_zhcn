/** One diagnostic event and its fields; the host writes each as one JSON record. */
export type RelayLog = (event: string, fields?: Record<string, unknown>) => void;

const MS_PER_SECOND = 1000;
export const BYTES_PER_KIB = 1024;

/** A duration as a log field reads it. */
export function wholeSeconds(ms: number): number {
  return Math.round(ms / MS_PER_SECOND);
}

/** Milliseconds per reason as log fields, whole: `{ gone: 3012.4 }` reads `{ goneMs: 3012 }`. */
export function msFields(split: Readonly<Partial<Record<string, number>>>): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const [key, ms] of Object.entries(split)) if (ms !== undefined) fields[`${key}Ms`] = Math.round(ms);
  return fields;
}

const UNPRINTABLE = /[\p{C}\p{Zl}\p{Zp}]/gu;

/** Text a peer chose, such as a close reason, as a log field: one line of at most `maxLength` code
 *  points, each control character replaced. It is logged, never interpreted. */
export function printable(text: string, maxLength: number): string {
  return Array.from(text.replace(UNPRINTABLE, '?')).slice(0, maxLength).join('');
}

/** A fault in the relay's own code: the message, and the stack that locates it in the build. */
export function faultFields(err: unknown): Record<string, string> {
  return err instanceof Error && err.stack !== undefined
    ? { error: String(err), stack: err.stack }
    : { error: String(err) };
}
