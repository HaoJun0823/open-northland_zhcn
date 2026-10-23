/// <reference path="./opus-wasm.d.ts" />
import { Encoder } from '@evan/opus/wasm/index.mjs';
import type { SoundQuality } from '@open-northland/data';
import { encodeFlac } from '@open-northland/formats/audio/flac';
import { oggOpus } from '@open-northland/formats/audio/ogg-opus';
import { resample } from '@open-northland/formats/audio/resample';
import { decodeWav } from '@open-northland/formats/wav';

/** Turns one source wav into one quality's bytes. */
export type SoundEncoder = (wav: Uint8Array, quality: SoundQuality) => Promise<Uint8Array>;

/** Opus codes 48 kHz audio; the clips are resampled up to it. */
const OPUS_RATE = 48000;
/** 20 ms packets, libopus's recommended frame size for stored audio. */
const OPUS_PACKET_SAMPLES = 960;
/**
 * Opus bit rate for the compact copy. The source clips are 22.05 kHz mono, so they carry nothing above
 * 11 kHz; the Opus project's recommended settings place mono music at 48 kbit/s and above as
 * transparent for most listeners, and speech needs less.
 */
const COMPACT_OPUS_BITRATE = 48_000;
/** libopus's slowest, best encoder search. */
const OPUS_COMPLEXITY = 10;
/** Encoder CTL request numbers (libopus `opus_defines.h`). */
const OPUS_SET_BITRATE = 4002;
const OPUS_SET_COMPLEXITY = 4010;
const OPUS_GET_LOOKAHEAD = 4027;
/** Every compact file is its own single-stream Ogg file, so one fixed serial keeps the bytes stable. */
const OGG_SERIAL = 0x4f4e5344;
const OPUS_VENDOR = 'Open Northland';
const INT16_SCALE = 32768;
const INT16_MAX = 32767;

/**
 * The served encodings: `lossless` is FLAC from the in-repo encoder, `compact` is Ogg Opus from
 * libopus's WebAssembly build, so building content needs nothing outside npm.
 *
 * A looped terrain bed stays FLAC in the compact quality as well (the index's `losslessOnly`): a lossy
 * encode does not keep the seam where the loop's end meets its start clean.
 */
export const encodeSound: SoundEncoder = async (wav, quality) => {
  const pcm = decodeWav(wav);
  return quality === 'lossless'
    ? encodeFlac({ sampleRate: pcm.sampleRate, channels: pcm.channels.map(toInt16) })
    : encodeOpus(pcm.channels, pcm.sampleRate);
};

/** Decoded wav samples (exact multiples of 1/32768) back to their 16-bit integers. */
function toInt16(channel: Float32Array): Int16Array {
  const out = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i++)
    out[i] = Math.max(-INT16_SCALE, Math.min(INT16_MAX, Math.round((channel[i] ?? 0) * INT16_SCALE)));
  return out;
}

function encodeOpus(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  if (channelCount !== 1 && channelCount !== 2) throw new Error(`opus: ${channelCount} channels`);
  const resampled = channels.map((c) => toInt16(resample(c, sampleRate, OPUS_RATE)));
  const samples = resampled[0]?.length ?? 0;
  const encoder = new Encoder({ channels: channelCount, sample_rate: OPUS_RATE, application: 'audio' });
  try {
    encoder.ctl(OPUS_SET_BITRATE, COMPACT_OPUS_BITRATE);
    encoder.ctl(OPUS_SET_COMPLEXITY, OPUS_COMPLEXITY);
    const preSkip = encoder.ctl(OPUS_GET_LOOKAHEAD);
    // The lookahead delays the decoded signal, so the input runs on in silence until it is flushed.
    const packetCount = Math.ceil((preSkip + samples) / OPUS_PACKET_SAMPLES);
    const frame = new Int16Array(OPUS_PACKET_SAMPLES * channelCount);
    const packets: Uint8Array[] = [];
    for (let p = 0; p < packetCount; p++) {
      frame.fill(0);
      const start = p * OPUS_PACKET_SAMPLES;
      for (let i = 0; i < OPUS_PACKET_SAMPLES && start + i < samples; i++)
        for (let c = 0; c < channelCount; c++) frame[i * channelCount + c] = resampled[c]?.[start + i] ?? 0;
      packets.push(encoder.encode(frame));
    }
    return oggOpus({
      channelCount,
      inputSampleRate: sampleRate,
      preSkip,
      packetSamples: OPUS_PACKET_SAMPLES,
      samples,
      packets,
      serial: OGG_SERIAL,
      vendor: OPUS_VENDOR,
    });
  } finally {
    encoder.drop();
  }
}
