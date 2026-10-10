/** One diagnostic event and its fields; the host writes each as one JSON record. */
export type RelayLog = (event: string, fields?: Record<string, unknown>) => void;

const MS_PER_SECOND = 1000;

/** A duration as a log field reads it. */
export function wholeSeconds(ms: number): number {
  return Math.round(ms / MS_PER_SECOND);
}
