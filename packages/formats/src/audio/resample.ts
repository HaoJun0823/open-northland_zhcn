/**
 * Band-limited sample rate conversion by a rational factor: a Kaiser-windowed sinc evaluated from a
 * per-phase table (polyphase), with samples outside the input read as silence.
 */

/** Zero crossings of the sinc kept on each side of the centre, at the narrower of the two rates. */
const HALF_ZERO_CROSSINGS = 16;
/** Kaiser window shape; 8.6 gives about 90 dB stop-band attenuation. */
const KAISER_BETA = 8.6;
/** The pass band ends this fraction of the way to the lower Nyquist frequency. */
const ROLLOFF = 0.95;
/** Phases the table may hold: rates whose ratio reduces to more than this are refused. */
const MAX_PHASES = 1 << 14;

/** `input` at `fromRate` converted to `toRate`; the output holds ceil(length * toRate / fromRate) samples. */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!Number.isInteger(fromRate) || !Number.isInteger(toRate) || fromRate <= 0 || toRate <= 0)
    throw new Error(`resample: rates ${fromRate} -> ${toRate}`);
  const common = gcd(fromRate, toRate);
  const up = toRate / common;
  const down = fromRate / common;
  if (up === 1 && down === 1) return input.slice();
  if (up > MAX_PHASES) throw new Error(`resample: ${fromRate} -> ${toRate} needs ${up} phases`);
  const scale = Math.min(1, toRate / fromRate);
  const half = Math.ceil(HALF_ZERO_CROSSINGS / scale);
  const taps = 2 * half;
  const table = phaseTable(up, half, scale * ROLLOFF);
  const out = new Float32Array(Math.ceil((input.length * up) / down));
  for (let n = 0; n < out.length; n++) {
    const position = n * down;
    const centre = Math.floor(position / up);
    const phase = position - centre * up;
    const first = centre - half + 1;
    const row = phase * taps;
    let sum = 0;
    const from = Math.max(0, -first);
    const to = Math.min(taps, input.length - first);
    for (let k = from; k < to; k++) sum += (table[row + k] ?? 0) * (input[first + k] ?? 0);
    out[n] = sum;
  }
  return out;
}

/** Row `phase` holds the weights of inputs `centre - half + 1 .. centre + half` for an output that
 *  sits `phase / phases` of a sample past `centre`; each row sums to one. */
function phaseTable(phases: number, half: number, cutoff: number): Float64Array {
  const taps = 2 * half;
  const table = new Float64Array(phases * taps);
  const norm = besselI0(KAISER_BETA);
  for (let phase = 0; phase < phases; phase++) {
    let total = 0;
    for (let k = 0; k < taps; k++) {
      const distance = half - 1 - k + phase / phases;
      const edge = distance / half;
      const window = Math.abs(edge) >= 1 ? 0 : besselI0(KAISER_BETA * Math.sqrt(1 - edge * edge)) / norm;
      const weight = cutoff * sinc(cutoff * distance) * window;
      table[phase * taps + k] = weight;
      total += weight;
    }
    for (let k = 0; k < taps; k++) table[phase * taps + k] = (table[phase * taps + k] ?? 0) / total;
  }
  return table;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const a = Math.PI * x;
  return Math.sin(a) / a;
}

/** The zeroth-order modified Bessel function of the first kind, by its power series. */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const quarter = (x * x) / 4;
  for (let k = 1; term > sum * Number.EPSILON; k++) {
    term *= quarter / (k * k);
    sum += term;
  }
  return sum;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
