import type { IncomingMessage } from 'node:http';

export function acceptsGzip(request: IncomingMessage): boolean {
  const header = request.headers['accept-encoding'];
  if (header === undefined) return false;
  const qualities = new Map<string, number>();
  for (const part of header.split(',')) {
    const [coding = '', ...parameters] = part.split(';').map((piece) => piece.trim().toLowerCase());
    const quality = parameters.find((parameter) => parameter.startsWith('q='));
    const value = quality === undefined ? 1 : Number(quality.slice(2));
    qualities.set(coding, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
  }
  return (qualities.get('gzip') ?? qualities.get('*') ?? 0) > 0;
}
