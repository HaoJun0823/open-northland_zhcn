import { BitWriter } from './bit-writer.js';

/**
 * A FLAC encoder (RFC 9639) for 16-bit PCM. Each channel is coded on its own (no stereo
 * decorrelation) as a constant, verbatim, fixed or LPC subframe, whichever costs the fewest bits, with
 * partitioned Rice residuals. Streams stay inside the subset (block size, LPC order, coefficient
 * precision, a sample rate in every frame header), so every conforming decoder reads them. The
 * STREAMINFO MD5 is left unset (all zero).
 */

export interface FlacPcm {
  readonly sampleRate: number;
  /** One array of signed 16-bit samples per channel, all the same length. */
  readonly channels: readonly Int16Array[];
}

export interface FlacOptions {
  /** Samples per channel in each frame but the last. */
  readonly blockSize?: number;
}

/** Of 2304, 4096 and 4608 samples, the smallest output over the mod's 22.05 kHz clips (by 0.1-0.4%). */
const DEFAULT_FLAC_BLOCK_SIZE = 2304;
const BITS_PER_SAMPLE = 16;
/** The subset's caps for streams up to 48 kHz. */
const SUBSET_MAX_LPC_ORDER = 12;
const SUBSET_MAX_BLOCK_SIZE = 4608;
const MIN_BLOCK_SIZE = 16;
const MAX_CHANNELS = 8;
const MAX_FIXED_ORDER = 4;
const MAX_PARTITION_ORDER = 8;
/** Coefficient precision cap: a 4-bit field in which 15 is reserved, plus one. */
const MAX_LPC_PRECISION = 15;
/** The 5-bit signed shift field's largest value; a negative shift is not allowed. */
const MAX_LPC_SHIFT = 15;
/** Precision is held to bits per sample + precision + floor(log2(order)) <= 32, so a decoder's
 *  prediction sum fits 32 bits (libFLAC's rule for its 32-bit path). */
const PREDICTION_SUM_BITS = 32;
/** A residual this large would not fit the decoder's 32-bit residual; the candidate is dropped. */
const MAX_RESIDUAL = 2 ** 30;
const RICE_PARAM_BITS = 4;
const RICE2_PARAM_BITS = 5;
const RICE_MAX_PARAM = 14;
const RICE2_MAX_PARAM = 30;
const LPC_PRECISION_FIELD_BITS = 4;
const LPC_SHIFT_FIELD_BITS = 5;
const SUBFRAME_HEADER_BITS = 8;
const RESIDUAL_HEADER_BITS = 6;
/** Taper fraction of the LPC analysis's Tukey window, libFLAC's default. A second window (0.1) saved
 *  0.1% on the mod's clips for 40% more encode time. */
const TUKEY_TAPER = 0.5;

const STREAM_MARKER = [0x66, 0x4c, 0x61, 0x43]; // "fLaC"
const LAST_METADATA_BLOCK = 0x80;
const STREAMINFO_TYPE = 0;
const STREAMINFO_BYTES = 34;
const FRAME_SYNC_FIXED = 0xfff8;

const SUBFRAME_CONSTANT = 0b000000;
const SUBFRAME_VERBATIM = 0b000001;
const SUBFRAME_FIXED = 0b001000;
const SUBFRAME_LPC = 0b100000;
const RESIDUAL_RICE = 0;
const RESIDUAL_RICE2 = 1;

/** Frame-header block size codes of the sizes that have one. */
const BLOCK_SIZE_CODES: ReadonlyMap<number, number> = new Map([
  [192, 1],
  [576, 2],
  [1152, 3],
  [2304, 4],
  [4608, 5],
  [256, 8],
  [512, 9],
  [1024, 10],
  [2048, 11],
  [4096, 12],
]);
const BLOCK_SIZE_8_BIT = 6;
const BLOCK_SIZE_16_BIT = 7;
const BLOCK_SIZE_8_BIT_MAX = 256;
/** Frame-header sample rate codes of the rates that have one. */
const SAMPLE_RATE_CODES: ReadonlyMap<number, number> = new Map([
  [88200, 1],
  [176400, 2],
  [192000, 3],
  [8000, 4],
  [16000, 5],
  [22050, 6],
  [24000, 7],
  [32000, 8],
  [44100, 9],
  [48000, 10],
  [96000, 11],
]);
/** Other rates follow the block size in the frame header; the subset forbids code 0 (STREAMINFO's). */
const SAMPLE_RATE_KHZ_8_BIT = 0b1100;
const SAMPLE_RATE_HZ_16_BIT = 0b1101;
const SAMPLE_RATE_TENS_HZ_16_BIT = 0b1110;
const HZ_PER_KHZ = 1000;
const HZ_PER_TEN_HZ = 10;
const MAX_8_BIT = 0xff;
const MAX_16_BIT = 0xffff;
const SAMPLE_SIZE_16_CODE = 0b100;

/** STREAMINFO field widths, in order; the MD5 after them stays zero. */
const STREAMINFO_BLOCK_SIZE_BITS = 16;
const STREAMINFO_FRAME_SIZE_BITS = 24;
const STREAMINFO_SAMPLE_RATE_BITS = 20;
const STREAMINFO_CHANNELS_BITS = 3;
const STREAMINFO_SAMPLE_BITS_BITS = 5;
const STREAMINFO_TOTAL_SAMPLES_BITS = 36;
const SUBFRAME_TYPE_BITS = 6;

/** How a frame header carries `sampleRate`: a code, plus the value and its width for codes 12-14. */
interface RateField {
  readonly code: number;
  readonly value: number;
  readonly bits: number;
}

function rateField(sampleRate: number): RateField {
  const own = SAMPLE_RATE_CODES.get(sampleRate);
  if (own !== undefined) return { code: own, value: 0, bits: 0 };
  if (sampleRate % HZ_PER_KHZ === 0 && sampleRate / HZ_PER_KHZ <= MAX_8_BIT)
    return { code: SAMPLE_RATE_KHZ_8_BIT, value: sampleRate / HZ_PER_KHZ, bits: 8 };
  if (sampleRate <= MAX_16_BIT) return { code: SAMPLE_RATE_HZ_16_BIT, value: sampleRate, bits: 16 };
  if (sampleRate % HZ_PER_TEN_HZ === 0 && sampleRate / HZ_PER_TEN_HZ <= MAX_16_BIT)
    return { code: SAMPLE_RATE_TENS_HZ_16_BIT, value: sampleRate / HZ_PER_TEN_HZ, bits: 16 };
  throw new Error(`flac: sample rate ${sampleRate} has no frame-header form`);
}

export function encodeFlac(pcm: FlacPcm, options: FlacOptions = {}): Uint8Array {
  const blockSize = options.blockSize ?? DEFAULT_FLAC_BLOCK_SIZE;
  const channelCount = pcm.channels.length;
  const total = pcm.channels[0]?.length ?? 0;
  if (channelCount < 1 || channelCount > MAX_CHANNELS) throw new Error(`flac: ${channelCount} channels`);
  if (pcm.channels.some((c) => c.length !== total)) throw new Error('flac: channels differ in length');
  if (!Number.isInteger(blockSize) || blockSize < MIN_BLOCK_SIZE || blockSize > SUBSET_MAX_BLOCK_SIZE)
    throw new Error(`flac: block size ${blockSize}`);
  if (!Number.isInteger(pcm.sampleRate) || pcm.sampleRate < 1)
    throw new Error(`flac: sample rate ${pcm.sampleRate}`);
  const rate = rateField(pcm.sampleRate);

  const out = new BitWriter();
  for (const byte of STREAM_MARKER) out.write(byte, 8);
  out.write(LAST_METADATA_BLOCK | STREAMINFO_TYPE, 8);
  out.write(STREAMINFO_BYTES, 24);
  const streamInfoAt = out.byteLength;
  for (let i = 0; i < STREAMINFO_BYTES; i++) out.write(0, 8);

  const analysis = new LpcAnalysis(SUBSET_MAX_LPC_ORDER);
  let minFrame = Number.POSITIVE_INFINITY;
  let maxFrame = 0;
  for (let start = 0, frame = 0; start < total; start += blockSize, frame++) {
    const size = Math.min(blockSize, total - start);
    const frameAt = out.byteLength;
    writeFrameHeader(out, { frame, size, blockSize, rate, channelCount });
    for (const channel of pcm.channels)
      writeSubframe(out, Int32Array.from(channel.subarray(start, start + size)), analysis);
    out.align();
    out.write(crc16(out.view(frameAt)), 16);
    minFrame = Math.min(minFrame, out.byteLength - frameAt);
    maxFrame = Math.max(maxFrame, out.byteLength - frameAt);
  }

  const bytes = out.finish();
  const info = new BitWriter();
  info.write(blockSize, STREAMINFO_BLOCK_SIZE_BITS);
  info.write(blockSize, STREAMINFO_BLOCK_SIZE_BITS);
  info.write(maxFrame === 0 ? 0 : minFrame, STREAMINFO_FRAME_SIZE_BITS);
  info.write(maxFrame, STREAMINFO_FRAME_SIZE_BITS);
  info.write(pcm.sampleRate, STREAMINFO_SAMPLE_RATE_BITS);
  info.write(channelCount - 1, STREAMINFO_CHANNELS_BITS);
  info.write(BITS_PER_SAMPLE - 1, STREAMINFO_SAMPLE_BITS_BITS);
  info.write(total, STREAMINFO_TOTAL_SAMPLES_BITS);
  bytes.set(info.finish(), streamInfoAt);
  return bytes;
}

interface FrameHeader {
  readonly frame: number;
  readonly size: number;
  readonly blockSize: number;
  readonly rate: RateField;
  readonly channelCount: number;
}

function writeFrameHeader(out: BitWriter, header: FrameHeader): void {
  const at = out.byteLength;
  out.write(FRAME_SYNC_FIXED, 16);
  const ownCode = header.size === header.blockSize ? BLOCK_SIZE_CODES.get(header.size) : undefined;
  const sizeCode = ownCode ?? (header.size <= BLOCK_SIZE_8_BIT_MAX ? BLOCK_SIZE_8_BIT : BLOCK_SIZE_16_BIT);
  out.write(sizeCode, 4);
  out.write(header.rate.code, 4);
  out.write(header.channelCount - 1, 4); // independent channels
  out.write(SAMPLE_SIZE_16_CODE, 3);
  out.write(0, 1);
  writeUtf8Number(out, header.frame);
  if (sizeCode === BLOCK_SIZE_8_BIT) out.write(header.size - 1, 8);
  else if (sizeCode === BLOCK_SIZE_16_BIT) out.write(header.size - 1, 16);
  out.write(header.rate.value, header.rate.bits);
  out.write(crc8(out.view(at)), 8);
}

/** The frame number in FLAC's extended UTF-8 form (up to 36 bits). */
function writeUtf8Number(out: BitWriter, value: number): void {
  if (value < 0x80) {
    out.write(value, 8);
    return;
  }
  // `trailing` continuation bytes carry 6 bits each, the lead byte 6 - trailing more.
  let trailing = 1;
  while (value >= 2 ** (5 * trailing + 6)) trailing++;
  const lead = (0xff << (7 - trailing)) & 0xff;
  out.write(lead | Math.floor(value / 2 ** (6 * trailing)), 8);
  for (let i = trailing - 1; i >= 0; i--) out.write(0x80 | (Math.floor(value / 2 ** (6 * i)) & 0x3f), 8);
}

/** How a block's residual is Rice-coded. */
interface RicePlan {
  readonly bits: number;
  readonly partitionOrder: number;
  readonly params: readonly number[];
}

type Subframe =
  | { readonly kind: 'verbatim'; readonly bits: number }
  | {
      readonly kind: 'fixed';
      readonly bits: number;
      readonly order: number;
      readonly residual: Int32Array;
      readonly rice: RicePlan;
    }
  | {
      readonly kind: 'lpc';
      readonly bits: number;
      readonly order: number;
      readonly precision: number;
      readonly shift: number;
      readonly coefficients: Int32Array;
      readonly residual: Int32Array;
      readonly rice: RicePlan;
    };

function writeSubframe(out: BitWriter, block: Int32Array, analysis: LpcAnalysis): void {
  const first = block[0] ?? 0;
  if (block.every((v) => v === first)) {
    out.write(SUBFRAME_CONSTANT << 1, SUBFRAME_HEADER_BITS);
    out.write(first, BITS_PER_SAMPLE);
    return;
  }
  const wasted = wastedBits(block);
  const x = wasted === 0 ? block : block.map((v) => v >> wasted);
  const bps = BITS_PER_SAMPLE - wasted;

  let best: Subframe = { kind: 'verbatim', bits: x.length * bps };
  for (let order = 0; order <= MAX_FIXED_ORDER && order < x.length; order++) {
    const residual = fixedResidual(x, order);
    const rice = planRice(residual, x.length, order);
    const bits = order * bps + rice.bits;
    if (bits < best.bits) best = { kind: 'fixed', bits, order, residual, rice };
  }
  for (const candidate of analysis.candidates(x, bps)) if (candidate.bits < best.bits) best = candidate;

  out.write(0, 1);
  out.write(
    best.kind === 'verbatim'
      ? SUBFRAME_VERBATIM
      : best.kind === 'fixed'
        ? SUBFRAME_FIXED | best.order
        : SUBFRAME_LPC | (best.order - 1),
    SUBFRAME_TYPE_BITS,
  );
  if (wasted > 0) {
    out.write(1, 1);
    out.unary(wasted - 1);
  } else out.write(0, 1);
  if (best.kind === 'verbatim') {
    for (const v of x) out.write(v, bps);
    return;
  }
  for (let i = 0; i < best.order; i++) out.write(x[i] ?? 0, bps);
  if (best.kind === 'lpc') {
    out.write(best.precision - 1, LPC_PRECISION_FIELD_BITS);
    out.write(best.shift, LPC_SHIFT_FIELD_BITS);
    for (const c of best.coefficients) out.write(c, best.precision);
  }
  writeResidual(out, best.residual, x.length, best.order, best.rice);
}

/** Low bits every sample of the block leaves zero, as in a clip scaled up from 8 bits. */
function wastedBits(block: Int32Array): number {
  let bits = 0;
  for (const v of block) bits |= v;
  let wasted = 0;
  while (wasted < BITS_PER_SAMPLE - 1 && (bits & (1 << wasted)) === 0) wasted++;
  return wasted;
}

/** The residual after FLAC's fixed polynomial predictor of `order`, for samples `order..`. */
function fixedResidual(x: Int32Array, order: number): Int32Array {
  const r = new Int32Array(x.length - order);
  for (let i = order; i < x.length; i++) {
    const a = x[i] ?? 0;
    const b = x[i - 1] ?? 0;
    const c = x[i - 2] ?? 0;
    const d = x[i - 3] ?? 0;
    const e = x[i - 4] ?? 0;
    r[i - order] =
      order === 0
        ? a
        : order === 1
          ? a - b
          : order === 2
            ? a - 2 * b + c
            : order === 3
              ? a - 3 * b + 3 * c - d
              : a - 4 * b + 6 * c - 4 * d + e;
  }
  return r;
}

/** LPC candidates for one block: every order up to the cap. */
class LpcAnalysis {
  private readonly windows = new Map<number, Float64Array>();
  private readonly maxOrder: number;

  constructor(maxOrder: number) {
    this.maxOrder = maxOrder;
  }

  *candidates(x: Int32Array, bps: number): Generator<Subframe> {
    const maxOrder = Math.min(this.maxOrder, x.length - 1);
    if (maxOrder < 1) return;
    const window = this.windowFor(x.length);
    const weighted = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) weighted[i] = (x[i] ?? 0) * (window[i] ?? 0);
    const predictors = levinson(autocorrelation(weighted, maxOrder), maxOrder);
    for (const [index, lp] of predictors.entries()) {
      const order = index + 1;
      const precision = Math.min(MAX_LPC_PRECISION, PREDICTION_SUM_BITS - bps - Math.floor(Math.log2(order)));
      const quantized = quantize(lp, precision);
      if (quantized === null) continue;
      const residual = lpcResidual(x, quantized.coefficients, quantized.shift);
      if (residual === null) continue;
      const rice = planRice(residual, x.length, order);
      const bits =
        order * bps + LPC_PRECISION_FIELD_BITS + LPC_SHIFT_FIELD_BITS + order * precision + rice.bits;
      yield { kind: 'lpc', bits, order, precision, ...quantized, residual, rice };
    }
  }

  private windowFor(length: number): Float64Array {
    let window = this.windows.get(length);
    if (window === undefined) {
      window = tukey(length, TUKEY_TAPER);
      this.windows.set(length, window);
    }
    return window;
  }
}

function tukey(length: number, taper: number): Float64Array {
  const w = new Float64Array(length).fill(1);
  const edge = (taper * (length - 1)) / 2;
  if (edge <= 0) return w;
  for (let i = 0; i < length; i++) {
    const fromEdge = Math.min(i, length - 1 - i);
    if (fromEdge < edge) w[i] = 0.5 * (1 - Math.cos((Math.PI * fromEdge) / edge));
  }
  return w;
}

function autocorrelation(x: Float64Array, maxLag: number): Float64Array {
  const r = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < x.length; i++) sum += (x[i] ?? 0) * (x[i - lag] ?? 0);
    r[lag] = sum;
  }
  return r;
}

/** Levinson-Durbin: the predictor `x[n] ~ sum lp[j] * x[n-1-j]` of every order up to `maxOrder`,
 *  stopping early when the prediction error vanishes. */
function levinson(r: Float64Array, maxOrder: number): Float64Array[] {
  const out: Float64Array[] = [];
  let lp = new Float64Array(0);
  let error = r[0] ?? 0;
  for (let i = 0; i < maxOrder && error > 0; i++) {
    let acc = r[i + 1] ?? 0;
    for (let j = 0; j < i; j++) acc -= (lp[j] ?? 0) * (r[i - j] ?? 0);
    const k = acc / error;
    const next = new Float64Array(i + 1);
    for (let j = 0; j < i; j++) next[j] = (lp[j] ?? 0) - k * (lp[i - 1 - j] ?? 0);
    next[i] = k;
    lp = next;
    error *= 1 - k * k;
    out.push(lp);
  }
  return out;
}

/** Coefficients in `precision`-bit integers with a right shift, rounding with error feedback as
 *  libFLAC does; null when no valid shift exists. */
function quantize(lp: Float64Array, precision: number): { coefficients: Int32Array; shift: number } | null {
  let max = 0;
  for (const c of lp) max = Math.max(max, Math.abs(c));
  if (!(max > 0) || !Number.isFinite(max)) return null;
  const exponent = Math.floor(Math.log2(max)) + 1; // max = m * 2^exponent, 0.5 <= m < 1
  const shift = Math.min(MAX_LPC_SHIFT, precision - 1 - exponent);
  if (shift < 0) return null;
  const limit = 2 ** (precision - 1);
  const coefficients = new Int32Array(lp.length);
  let error = 0;
  for (let i = 0; i < lp.length; i++) {
    error += (lp[i] ?? 0) * 2 ** shift;
    const q = Math.max(-limit, Math.min(limit - 1, Math.round(error)));
    coefficients[i] = q;
    error -= q;
  }
  return { coefficients, shift };
}

function lpcResidual(x: Int32Array, q: Int32Array, shift: number): Int32Array | null {
  const order = q.length;
  const r = new Int32Array(x.length - order);
  for (let i = order; i < x.length; i++) {
    let sum = 0;
    for (let j = 0; j < order; j++) sum += (q[j] ?? 0) * (x[i - 1 - j] ?? 0);
    const residual = (x[i] ?? 0) - (sum >> shift);
    if (Math.abs(residual) >= MAX_RESIDUAL) return null;
    r[i - order] = residual;
  }
  return r;
}

/** A signed residual folded onto the non-negative integers (0, -1, 1, -2, ... -> 0, 1, 2, 3, ...). */
const fold = (v: number): number => (v >= 0 ? 2 * v : -2 * v - 1);

/** Estimated bits of `count` folded values summing to `sum` under Rice parameter `k`, assuming
 *  uniform low bits. */
function riceBits(count: number, sum: number, k: number): number {
  const scale = 2 ** k;
  return count * (k + 1) + Math.max(0, (sum - (count * (scale - 1)) / 2) / scale);
}

/** The Rice parameter for `count` folded values summing to `sum`: the estimate's minimum lies at
 *  floor(log2(mean)) or one either side. */
function bestParam(count: number, sum: number): number {
  if (count === 0 || sum < count) return 0;
  const guess = Math.min(RICE2_MAX_PARAM, Math.floor(Math.log2(sum / count)));
  let param = guess;
  let bits = riceBits(count, sum, guess);
  if (guess > 0) {
    const lower = riceBits(count, sum, guess - 1);
    if (lower < bits) {
      param = guess - 1;
      bits = lower;
    }
  }
  if (guess < RICE2_MAX_PARAM && riceBits(count, sum, guess + 1) < bits) param = guess + 1;
  return param;
}

/** The partition order and Rice parameters with the fewest estimated bits for the residual of a
 *  `blockLength`-sample block predicted at `order`. */
function planRice(residual: Int32Array, blockLength: number, order: number): RicePlan {
  let maxOrder = 0;
  while (
    maxOrder < MAX_PARTITION_ORDER &&
    blockLength % 2 ** (maxOrder + 1) === 0 &&
    blockLength / 2 ** (maxOrder + 1) > order
  )
    maxOrder++;
  let parts = 2 ** maxOrder;
  const partSize = blockLength / parts;
  let sums = new Float64Array(parts);
  let counts = new Float64Array(parts);
  for (let p = 0; p < parts; p++) {
    const start = p === 0 ? 0 : p * partSize - order;
    const end = (p + 1) * partSize - order;
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = residual[i] ?? 0;
      sum += v >= 0 ? 2 * v : -2 * v - 1;
    }
    sums[p] = sum;
    counts[p] = end - start;
  }
  let best: RicePlan | null = null;
  for (let partitionOrder = maxOrder; partitionOrder >= 0; partitionOrder--) {
    const params: number[] = [];
    let bits = RESIDUAL_HEADER_BITS;
    for (let p = 0; p < parts; p++) {
      const count = counts[p] ?? 0;
      const sum = sums[p] ?? 0;
      const param = bestParam(count, sum);
      params.push(param);
      bits += count === 0 ? 0 : riceBits(count, sum, param);
    }
    bits += parts * (params.some((k) => k > RICE_MAX_PARAM) ? RICE2_PARAM_BITS : RICE_PARAM_BITS);
    if (best === null || bits < best.bits) best = { bits, partitionOrder, params };
    if (partitionOrder === 0) break;
    parts /= 2;
    const mergedSums = new Float64Array(parts);
    const mergedCounts = new Float64Array(parts);
    for (let p = 0; p < parts; p++) {
      mergedSums[p] = (sums[2 * p] ?? 0) + (sums[2 * p + 1] ?? 0);
      mergedCounts[p] = (counts[2 * p] ?? 0) + (counts[2 * p + 1] ?? 0);
    }
    sums = mergedSums;
    counts = mergedCounts;
  }
  if (best === null) throw new Error('flac: no Rice plan');
  return best;
}

function writeResidual(
  out: BitWriter,
  residual: Int32Array,
  blockLength: number,
  order: number,
  plan: RicePlan,
): void {
  const wide = plan.params.some((k) => k > RICE_MAX_PARAM);
  out.write(wide ? RESIDUAL_RICE2 : RESIDUAL_RICE, 2);
  out.write(plan.partitionOrder, 4);
  const partSize = blockLength / 2 ** plan.partitionOrder;
  for (const [p, k] of plan.params.entries()) {
    out.write(k, wide ? RICE2_PARAM_BITS : RICE_PARAM_BITS);
    const start = p === 0 ? 0 : p * partSize - order;
    const end = (p + 1) * partSize - order;
    const scale = 2 ** k;
    for (let i = start; i < end; i++) {
      const u = fold(residual[i] ?? 0);
      out.unary(Math.floor(u / scale));
      out.write(u % scale, k);
    }
  }
}

const CRC8_POLY = 0x07;
const CRC16_POLY = 0x8005;
const CRC8_TABLE = crcTable(CRC8_POLY, 8);
const CRC16_TABLE = crcTable(CRC16_POLY, 16);

/** A most-significant-bit-first CRC table for `poly` of `width` bits, initial value zero. */
function crcTable(poly: number, width: number): Uint16Array {
  const top = 1 << (width - 1);
  const mask = (1 << width) - 1;
  const table = new Uint16Array(256);
  for (let byte = 0; byte < 256; byte++) {
    let crc = byte << (width - 8);
    for (let bit = 0; bit < 8; bit++) crc = (crc & top ? (crc << 1) ^ poly : crc << 1) & mask;
    table[byte] = crc;
  }
  return table;
}

/** FLAC's frame-header CRC-8 (polynomial x^8 + x^2 + x + 1). */
export function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = CRC8_TABLE[crc ^ byte] ?? 0;
  return crc;
}

/** FLAC's frame CRC-16 (polynomial x^16 + x^15 + x^2 + 1). */
export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) & 0xffff) ^ (CRC16_TABLE[(crc >> 8) ^ byte] ?? 0);
  return crc;
}
