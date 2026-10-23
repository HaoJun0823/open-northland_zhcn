import { oggStream } from './ogg.js';

/**
 * Ogg Opus encapsulation (RFC 7845, channel mapping family 0) of packets an Opus encoder produced:
 * the identification header, an empty comment header and the audio pages, with granule positions in
 * 48 kHz samples and the stream's end trimmed by the last page's granule.
 */
export interface OggOpusStream {
  /** Mapping family 0 carries one or two channels. */
  readonly channelCount: number;
  /** Rate of the source before encoding, informational for decoders. */
  readonly inputSampleRate: number;
  /** 48 kHz samples the decoder drops from the start: the encoder's lookahead. */
  readonly preSkip: number;
  /** 48 kHz samples each packet decodes to. */
  readonly packetSamples: number;
  /** 48 kHz samples of audio after the pre-skip; later decoded samples are trimmed. */
  readonly samples: number;
  readonly packets: readonly Uint8Array[];
  readonly serial: number;
  readonly vendor: string;
}

/** OpusHead layout (RFC 7845 section 5.1); output gain at 16-17 stays zero. */
const OPUS_HEAD_BYTES = 19;
const HEAD_VERSION_OFFSET = 8;
const HEAD_CHANNELS_OFFSET = 9;
const HEAD_PRE_SKIP_OFFSET = 10;
const HEAD_INPUT_RATE_OFFSET = 12;
const HEAD_MAPPING_FAMILY_OFFSET = 18;
/** OpusTags layout (section 5.2): magic, vendor length, vendor, then a zero user comment count. */
const TAGS_MAGIC_BYTES = 8;
const TAGS_LENGTH_FIELD_BYTES = 4;
const OPUS_VERSION = 1;
const MAPPING_FAMILY_RTP = 0;
const MAX_FAMILY_0_CHANNELS = 2;
const MAX_PRE_SKIP = 0xffff;

export function oggOpus(stream: OggOpusStream): Uint8Array {
  if (stream.channelCount < 1 || stream.channelCount > MAX_FAMILY_0_CHANNELS)
    throw new Error(`ogg opus: ${stream.channelCount} channels`);
  if (stream.preSkip < 0 || stream.preSkip > MAX_PRE_SKIP)
    throw new Error(`ogg opus: pre-skip ${stream.preSkip}`);
  const end = stream.preSkip + stream.samples;
  if (stream.packets.length * stream.packetSamples < end)
    throw new Error('ogg opus: packets end before the samples they should hold');
  const head = new Uint8Array(OPUS_HEAD_BYTES);
  const view = new DataView(head.buffer);
  head.set(ascii('OpusHead'));
  head[HEAD_VERSION_OFFSET] = OPUS_VERSION;
  head[HEAD_CHANNELS_OFFSET] = stream.channelCount;
  view.setUint16(HEAD_PRE_SKIP_OFFSET, stream.preSkip, true);
  view.setUint32(HEAD_INPUT_RATE_OFFSET, stream.inputSampleRate, true);
  head[HEAD_MAPPING_FAMILY_OFFSET] = MAPPING_FAMILY_RTP;
  const vendor = new TextEncoder().encode(stream.vendor);
  const vendorAt = TAGS_MAGIC_BYTES + TAGS_LENGTH_FIELD_BYTES;
  const tags = new Uint8Array(vendorAt + vendor.length + TAGS_LENGTH_FIELD_BYTES);
  tags.set(ascii('OpusTags'));
  new DataView(tags.buffer).setUint32(TAGS_MAGIC_BYTES, vendor.length, true);
  tags.set(vendor, vendorAt);
  return oggStream(stream.serial, [
    { data: head, granule: 0, flush: true },
    { data: tags, granule: 0, flush: true },
    ...stream.packets.map((data, i) => ({ data, granule: Math.min((i + 1) * stream.packetSamples, end) })),
  ]);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
