const ID_BYTES = 16;
const HEX_RADIX = 16;
const HEX_DIGITS = 2;

/** A fresh report id: 128 random bits as lowercase hex, the wire's `REPORT_ID`. */
export function randomReportId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS, '0')).join('');
}
