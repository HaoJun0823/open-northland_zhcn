import {
  briefingVoiceFile,
  briefingVoiceSuffix,
  briefingVoices,
  type MapBriefing,
} from '@open-northland/data';
import { inspectWav, WavDecodeError } from '@open-northland/formats/audio/wav';
import type { MapFolder } from './folder.js';
import { VOICE_DIR } from './layout.js';

/** The clips the briefing's pages speak that the folder ships under `sfx/<lang>/`, by stored suffix.
 *  A clip the folder lacks, or one the narration could not decode, is left out: its callback stays
 *  silent and the map lists no player for it. */
export function resolveBriefingVoices(folder: MapFolder, briefing: MapBriefing): Map<string, Uint8Array> {
  const voices = new Map<string, Uint8Array>();
  for (const voice of briefingVoices(briefing)) {
    const file = briefingVoiceFile(voice.id);
    const bytes = folder.read([VOICE_DIR, voice.lang, file]);
    if (bytes === undefined) continue;
    const refusal = unplayable(bytes);
    if (refusal === null) voices.set(briefingVoiceSuffix(voice), bytes);
    else folder.warn(`${VOICE_DIR}/${voice.lang}/${file} ${refusal}`);
  }
  return voices;
}

/** Why the narration would refuse `bytes`, or null when it decodes to sound. */
function unplayable(bytes: Uint8Array): string | null {
  try {
    return inspectWav(bytes).frames > 0 ? null : 'holds no sound';
  } catch (error) {
    if (!(error instanceof WavDecodeError)) throw error;
    return error.failure === 'notWav' ? 'is not a wav' : `is not a playable wav (${error.message})`;
  }
}
