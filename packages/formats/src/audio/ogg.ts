/**
 * Ogg page framing (RFC 3533): packets laced into 255-byte segments, at most 255 segments a page,
 * each page carrying its stream serial, sequence number, granule position and CRC.
 */

export interface OggPacket {
  readonly data: Uint8Array;
  /** The codec's position after this packet; a page takes the granule of its last finished packet. */
  readonly granule: number;
  /** Ends the page after this packet, as a codec's header packets need. */
  readonly flush?: boolean;
}

const CAPTURE = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
const HEADER_BYTES = 27;
const MAX_SEGMENTS = 255;
const SEGMENT_BYTES = 255;
const FLAG_CONTINUED = 0x01;
const FLAG_FIRST = 0x02;
const FLAG_LAST = 0x04;
/** A page on which no packet finishes. */
const NO_GRANULE = -1;
const GRANULE_OFFSET = 6;
const SERIAL_OFFSET = 14;
const SEQUENCE_OFFSET = 18;
const CRC_OFFSET = 22;
const SEGMENT_COUNT_OFFSET = 26;

interface Segment {
  readonly bytes: Uint8Array;
  /** Set on a packet's final segment. */
  readonly packet: OggPacket | null;
}

/** One logical stream holding `packets` in order, its first page marked first and its last last. */
export function oggStream(serial: number, packets: readonly OggPacket[]): Uint8Array {
  const pages: Uint8Array[] = [];
  let pending: Segment[] = [];
  let continued = false;
  const flush = (last: boolean): void => {
    const finished = pending.filter((s) => s.packet !== null);
    const granule = finished.at(-1)?.packet?.granule ?? NO_GRANULE;
    const flags =
      (continued ? FLAG_CONTINUED : 0) | (pages.length === 0 ? FLAG_FIRST : 0) | (last ? FLAG_LAST : 0);
    pages.push(page(serial, pages.length, flags, granule, pending));
    continued = pending.at(-1)?.packet === null;
    pending = [];
  };
  for (const [index, packet] of packets.entries()) {
    // A packet of an exact multiple of 255 bytes ends with an empty segment.
    for (let at = 0; ; at += SEGMENT_BYTES) {
      const end = Math.min(at + SEGMENT_BYTES, packet.data.length);
      const finalSegment = end - at < SEGMENT_BYTES;
      pending.push({ bytes: packet.data.subarray(at, end), packet: finalSegment ? packet : null });
      if (pending.length === MAX_SEGMENTS && !(finalSegment && index === packets.length - 1)) flush(false);
      if (finalSegment) break;
    }
    if (index === packets.length - 1) flush(true);
    else if (packet.flush === true && pending.length > 0) flush(false);
  }
  const out = new Uint8Array(pages.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of pages) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function page(
  serial: number,
  sequence: number,
  flags: number,
  granule: number,
  segments: Segment[],
): Uint8Array {
  const body = segments.reduce((sum, s) => sum + s.bytes.length, 0);
  const out = new Uint8Array(HEADER_BYTES + segments.length + body);
  const view = new DataView(out.buffer);
  out.set(CAPTURE);
  out[5] = flags; // byte 4 is the stream structure version, 0
  view.setBigInt64(GRANULE_OFFSET, BigInt(granule), true);
  view.setUint32(SERIAL_OFFSET, serial, true);
  view.setUint32(SEQUENCE_OFFSET, sequence, true);
  out[SEGMENT_COUNT_OFFSET] = segments.length;
  let at = HEADER_BYTES;
  for (const s of segments) out[at++] = s.bytes.length;
  for (const s of segments) {
    out.set(s.bytes, at);
    at += s.bytes.length;
  }
  view.setUint32(CRC_OFFSET, oggCrc(out), true);
  return out;
}

const CRC_POLY = 0x04c11db7;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let byte = 0; byte < 256; byte++) {
    let crc = byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ CRC_POLY : crc << 1;
    table[byte] = crc >>> 0;
  }
  return table;
})();

/** Ogg's page CRC-32: polynomial 0x04c11db7, most significant bit first, initial value and final XOR
 *  zero, over the page with its CRC field zeroed. */
export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ (CRC_TABLE[(crc >>> 24) ^ byte] ?? 0)) >>> 0;
  return crc;
}
