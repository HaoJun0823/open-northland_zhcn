/** One JSON line per event, for a log collector to read as a record. */
export function logLine(event: string, fields?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
