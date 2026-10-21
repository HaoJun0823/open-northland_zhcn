import { describe, expect, it } from 'vitest';
import { activeCue, movieSubtitles, parseSrt, subtitleTracks } from '../src/campaign/subtitles.js';

const SAMPLE = `1
00:00:01,000 --> 00:00:03,500
First line.

2
00:00:04,000 --> 00:00:06,000
Second line, with a comma.

3
00:00:07.250 --> 00:00:08.000
Dot millis.
`;

describe('parseSrt', () => {
  it('reads cues with their timeline and keeps source line breaks', () => {
    const cues = parseSrt(SAMPLE);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: 'First line.' },
      { start: 4, end: 6, text: 'Second line, with a comma.' },
      { start: 7.25, end: 8, text: 'Dot millis.' },
    ]);
  });

  it('skips a leading index line and empty blocks', () => {
    const cues = parseSrt(`\n\n1\n00:00:00,000 --> 00:00:01,000\nOnly.\n\n`);
    expect(cues).toEqual([{ start: 0, end: 1, text: 'Only.' }]);
  });

  it('drops malformed blocks without a timecode or text', () => {
    expect(parseSrt('00:00:00,000 --> 00:00:01,000\n')).toEqual([]);
    expect(parseSrt('just text\nwith no timecode\n')).toEqual([]);
  });
});

describe('activeCue', () => {
  const cues = parseSrt(SAMPLE);

  it('returns the cue spanning the time, and nothing before or after', () => {
    expect(activeCue(cues, 0)).toBeUndefined();
    expect(activeCue(cues, 2)).toEqual({ start: 1, end: 3.5, text: 'First line.' });
    expect(activeCue(cues, 3.5)).toBeUndefined();
    expect(activeCue(cues, 9)).toBeUndefined();
  });

  it('finds the last-starting cue on overlap', () => {
    const overlapping = [
      { start: 0, end: 10, text: 'wide' },
      { start: 5, end: 6, text: 'narrow' },
    ];
    expect(activeCue(overlapping, 5.5)).toEqual({ start: 5, end: 6, text: 'narrow' });
  });
});

describe('subtitleTracks', () => {
  const urls = {
    eng: '/campaigns/x/films/eng/intro.srt',
    chs: '/campaigns/x/films/chs/intro.srt',
  };

  it('lists requested languages in preference order', () => {
    expect(subtitleTracks(urls, ['eng', 'chs'])).toEqual([
      { language: 'eng', url: urls.eng },
      { language: 'chs', url: urls.chs },
    ]);
  });

  it('deduplicates repeated languages', () => {
    expect(subtitleTracks(urls, ['eng', 'eng'])).toEqual([{ language: 'eng', url: urls.eng }]);
  });

  it('drops a language the film carries no subtitle for', () => {
    expect(subtitleTracks({ eng: urls.eng }, ['eng', 'chs'])).toEqual([{ language: 'eng', url: urls.eng }]);
    expect(subtitleTracks(urls, ['ger', 'chs'])).toEqual([{ language: 'chs', url: urls.chs }]);
  });

  it('skips an unknown language and an absent subtitle map', () => {
    expect(subtitleTracks(urls, [undefined, 'chs'])).toEqual([{ language: 'chs', url: urls.chs }]);
    expect(subtitleTracks(undefined, ['eng', 'chs'])).toEqual([]);
  });
});

describe('subtitle defaults', () => {
  it.each(['eng', 'ger', 'pol', 'rus', 'chs', 'cht'] as const)(
    'keeps matching %s audio optional',
    (language) => {
      expect(movieSubtitles({ [language]: '/film.srt' }, language, language)).toEqual({
        visible: false,
        tracks: [{ language, url: '/film.srt' }],
      });
    },
  );
  it('shows the translation when the audio falls back to English', () => {
    expect(movieSubtitles({ eng: '/en.srt', rus: '/ru.srt' }, 'eng', 'rus')).toEqual({
      visible: true,
      tracks: [
        { language: 'rus', url: '/ru.srt' },
        { language: 'eng', url: '/en.srt' },
      ],
    });
  });
});

it('offers English first when UI subtitles are unavailable, then other available languages', () => {
  expect(movieSubtitles({ eng: '/en.srt', pol: '/pl.srt', chs: '/zh.srt' }, 'eng', 'cht').tracks).toEqual([
    { language: 'eng', url: '/en.srt' },
    { language: 'pol', url: '/pl.srt' },
    { language: 'chs', url: '/zh.srt' },
  ]);
});
