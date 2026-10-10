/**
 * Thrown when a header declares more than the caller's bound, before the decoder allocates for it. A
 * caller decoding untrusted input tells this apart from corruption to answer "too large".
 */
export class DecodeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeLimitError';
  }
}
