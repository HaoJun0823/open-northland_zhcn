import { DEFAULT_MUSIC_BASE_URL, DEFAULT_SOUNDS_BASE_URL } from '@open-northland/audio';
import { describe, expect, it } from 'vitest';
import { contentAudioOptions } from '../src/content/audio.js';
import { contentUrl } from '../src/content/url.js';

describe('contentAudioOptions', () => {
  it.each(['lossless', 'compact'] as const)('carries the %s sound quality to the engine', (quality) => {
    const options = contentAudioOptions(quality);
    expect(options.soundQuality).toBe(quality);
    expect(options.baseUrl).toBe(contentUrl(DEFAULT_SOUNDS_BASE_URL));
    expect(options.musicBaseUrl).toBe(contentUrl(DEFAULT_MUSIC_BASE_URL));
  });
});
