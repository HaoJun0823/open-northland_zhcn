/** The WebAssembly build of `@evan/opus` (libopus), loaded directly so no native addon is picked. */
declare module '@evan/opus/wasm/index.mjs' {
  export class Encoder {
    constructor(options: { channels: 1 | 2; sample_rate: 48000; application: 'audio' });
    /** An encoder CTL request: with `value` a setter (throws on error), without one a getter. */
    ctl(request: number, value?: number): number;
    /** One frame of interleaved signed 16-bit samples to one Opus packet. */
    encode(pcm: Int16Array): Uint8Array;
    drop(): void;
  }
  export class Decoder {
    constructor(options: { channels: 1 | 2; sample_rate: 48000 });
    /** One Opus packet to interleaved signed 16-bit samples (bytes). */
    decode(packet: Uint8Array): Uint8Array;
    drop(): void;
  }
}
