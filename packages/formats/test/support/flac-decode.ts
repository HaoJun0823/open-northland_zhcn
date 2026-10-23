import { crc8, crc16 } from '../../src/audio/flac.js';

/** A FLAC reader for tests: the subset the encoder writes (fixed block size, independent channels,
 *  16-bit samples, a sample rate in every frame header), checking both CRCs, to prove the encoder's
 *  streams decode bit for bit. */
export interface DecodedFlac {
  readonly sampleRate: number;
  readonly totalSamples: number;
  readonly minBlockSize: number;
  readonly maxBlockSize: number;
  readonly channels: Int16Array[];
}

class BitReader {
  pos = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  bit(): number {
    const byte = this.bytes[this.pos >> 3];
    if (byte === undefined) throw new Error('flac test decoder: overrun');
    const bit = (byte >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return bit;
  }
  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) v = v * 2 + this.bit();
    return v;
  }
  signed(bits: number): number {
    if (bits === 0) return 0;
    const v = this.read(bits);
    return v >= 2 ** (bits - 1) ? v - 2 ** bits : v;
  }
  unary(): number {
    let zeros = 0;
    while (this.bit() === 0) zeros++;
    return zeros;
  }
  align(): void {
    this.pos = Math.ceil(this.pos / 8) * 8;
  }
}

const BLOCK_SIZES: Readonly<Record<number, number>> = {
  1: 192,
  2: 576,
  3: 1152,
  4: 2304,
  5: 4608,
  8: 256,
  9: 512,
  10: 1024,
  11: 2048,
  12: 4096,
};

const SAMPLE_RATES: Readonly<Record<number, number>> = {
  1: 88200,
  2: 176400,
  3: 192000,
  4: 8000,
  5: 16000,
  6: 22050,
  7: 24000,
  8: 32000,
  9: 44100,
  10: 48000,
  11: 96000,
};

/** The frame header's sample rate: a code, or the value after the block size for codes 12-14. Code 0
 *  (STREAMINFO's rate) is outside the subset and rejected. */
function frameSampleRate(r: BitReader, code: number): number {
  if (code === 12) return r.read(8) * 1000;
  if (code === 13) return r.read(16);
  if (code === 14) return r.read(16) * 10;
  const rate = SAMPLE_RATES[code];
  if (rate === undefined) throw new Error(`sample rate code ${code} outside the subset`);
  return rate;
}

export function decodeFlac(bytes: Uint8Array): DecodedFlac {
  const r = new BitReader(bytes);
  if (r.read(32) !== 0x664c6143) throw new Error('no fLaC marker');
  let info: Omit<DecodedFlac, 'channels'> & { channelCount: number } = {
    sampleRate: 0,
    totalSamples: 0,
    minBlockSize: 0,
    maxBlockSize: 0,
    channelCount: 0,
  };
  for (let last = 0; last === 0; ) {
    last = r.read(1);
    const type = r.read(7);
    const length = r.read(24);
    const end = r.pos + length * 8;
    if (type === 0) {
      const minBlockSize = r.read(16);
      const maxBlockSize = r.read(16);
      r.read(48);
      const sampleRate = r.read(20);
      const channelCount = r.read(3) + 1;
      if (r.read(5) + 1 !== 16) throw new Error('not 16-bit');
      info = { sampleRate, totalSamples: r.read(36), minBlockSize, maxBlockSize, channelCount };
    }
    r.pos = end;
  }
  const channels = Array.from({ length: info.channelCount }, () => new Int16Array(info.totalSamples));
  let at = 0;
  for (let frame = 0; at < info.totalSamples; frame++) {
    const start = r.pos / 8;
    if (r.read(16) !== 0xfff8) throw new Error(`frame ${frame}: bad sync`);
    const sizeCode = r.read(4);
    const rateCode = r.read(4);
    if (r.read(4) !== info.channelCount - 1) throw new Error('not independent channels');
    r.read(4);
    const lead = r.read(8);
    let number = lead;
    if (lead >= 0x80) {
      let trailing = 0;
      while (lead & (0x40 >> trailing)) trailing++;
      number = lead & (0x3f >> trailing);
      for (let i = 0; i < trailing; i++) number = number * 64 + (r.read(8) & 0x3f);
    }
    if (number !== frame) throw new Error(`frame ${frame}: numbered ${number}`);
    const size =
      sizeCode === 6 ? r.read(8) + 1 : sizeCode === 7 ? r.read(16) + 1 : (BLOCK_SIZES[sizeCode] ?? 0);
    const rate = frameSampleRate(r, rateCode);
    if (rate !== info.sampleRate)
      throw new Error(`frame ${frame}: rate ${rate}, STREAMINFO ${info.sampleRate}`);
    if (crc8(bytes.subarray(start, r.pos / 8)) !== r.read(8)) throw new Error(`frame ${frame}: header CRC`);
    for (const channel of channels) channel.set(subframe(r, size), at);
    r.align();
    if (crc16(bytes.subarray(start, r.pos / 8)) !== r.read(16)) throw new Error(`frame ${frame}: CRC`);
    at += size;
  }
  if (r.pos / 8 !== bytes.length) throw new Error('trailing bytes');
  const { channelCount: _, ...rest } = info;
  return { ...rest, channels };
}

function subframe(r: BitReader, size: number): Int32Array {
  if (r.read(1) !== 0) throw new Error('subframe padding bit');
  const type = r.read(6);
  const wasted = r.read(1) === 1 ? r.unary() + 1 : 0;
  const bps = 16 - wasted;
  const x = new Int32Array(size);
  if (type === 0) x.fill(r.signed(bps));
  else if (type === 1) for (let i = 0; i < size; i++) x[i] = r.signed(bps);
  else if (type >= 8 && type <= 12) {
    const order = type - 8;
    for (let i = 0; i < order; i++) x[i] = r.signed(bps);
    const res = residual(r, size, order);
    const c = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]][order] ?? [];
    for (let i = order; i < size; i++) {
      let p = 0;
      for (let j = 0; j < order; j++) p += (c[j] ?? 0) * (x[i - 1 - j] ?? 0);
      x[i] = p + (res[i - order] ?? 0);
    }
  } else if (type >= 32) {
    const order = type - 31;
    for (let i = 0; i < order; i++) x[i] = r.signed(bps);
    const precision = r.read(4) + 1;
    const shift = r.signed(5);
    const q = Array.from({ length: order }, () => r.signed(precision));
    const res = residual(r, size, order);
    for (let i = order; i < size; i++) {
      let p = 0;
      for (let j = 0; j < order; j++) p += (q[j] ?? 0) * (x[i - 1 - j] ?? 0);
      x[i] = Math.floor(p / 2 ** shift) + (res[i - order] ?? 0);
    }
  } else throw new Error(`subframe type ${type}`);
  return wasted === 0 ? x : x.map((v) => v * 2 ** wasted);
}

function residual(r: BitReader, size: number, order: number): number[] {
  const method = r.read(2);
  const paramBits = method === 0 ? 4 : 5;
  const escapeCode = method === 0 ? 15 : 31;
  const partitionOrder = r.read(4);
  const out: number[] = [];
  for (let p = 0; p < 2 ** partitionOrder; p++) {
    const count = (size >> partitionOrder) - (p === 0 ? order : 0);
    const k = r.read(paramBits);
    if (k === escapeCode) {
      const bits = r.read(5);
      for (let i = 0; i < count; i++) out.push(r.signed(bits));
      continue;
    }
    for (let i = 0; i < count; i++) {
      const u = r.unary() * 2 ** k + r.read(k);
      out.push(u % 2 === 0 ? u / 2 : -(u + 1) / 2);
    }
  }
  return out;
}
