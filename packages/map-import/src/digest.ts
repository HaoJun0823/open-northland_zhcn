const HEX = 16;
const HEX_BYTE_DIGITS = 2;

/** The SHA-256 of `bytes` as lower-case hex; a raw `map.dat`'s digest names its translation overlays. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
  return Array.from(digest, (byte) => byte.toString(HEX).padStart(HEX_BYTE_DIGITS, '0')).join('');
}
