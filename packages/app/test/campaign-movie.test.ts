// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { movieClock, movieMusicHold, playCampaignMovie } from '../src/campaign/movie.js';

/** A film silences the page's music once and gives it back once, on every way the film ends. */

const LABELS = {
  play: 'Play',
  skip: 'Skip',
  failed: 'Failed',
  seek: 'Position',
  subtitles: 'Subtitles',
  subtitlesOff: 'Hide subtitles',
};
const MOVIE = {
  sequence: 0,
  url: '/campaigns/test/video/intro.webm',
  audio: '/campaigns/test/eng/intro.webm',
  width: 640,
  height: 480,
};

function silencer(): {
  readonly silence: () => () => void;
  readonly state: { taken: number; given: number };
} {
  const state = { taken: 0, given: 0 };
  return {
    state,
    silence: () => {
      state.taken++;
      return () => {
        state.given++;
      };
    },
  };
}

function surface(): HTMLDialogElement {
  const dialog = document.querySelector<HTMLDialogElement>('.campaign-movie');
  if (dialog === null) throw new Error('no movie surface');
  return dialog;
}

function tracks(): { video: HTMLVideoElement; sound: HTMLAudioElement } {
  const video = surface().querySelector('video');
  const sound = surface().querySelector('audio');
  if (video === null || sound === null) throw new Error('no film tracks');
  return { video, sound };
}

/** jsdom plays nothing; a track's natural end is its `ended` flag and event. */
function endTrack(element: HTMLMediaElement): void {
  Object.defineProperty(element, 'ended', { value: true });
  element.dispatchEvent(new Event('ended'));
}

/** Resolves to whether `done` settled by the next macrotask. */
async function settled(done: Promise<void>): Promise<boolean> {
  let resolved = false;
  void done.then(() => (resolved = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return resolved;
}

beforeEach(() => {
  // An open dialog renders its controls, so jsdom lets them take focus.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('movieMusicHold', () => {
  it('takes the silence at once and gives it back only once', () => {
    const { silence, state } = silencer();
    const hold = movieMusicHold(silence);
    expect(state).toEqual({ taken: 1, given: 0 });
    hold.release();
    hold.release();
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('is a no-op without a silencer', () => {
    expect(() => movieMusicHold(undefined).release()).not.toThrow();
  });
});

describe('playCampaignMovie media', () => {
  it('plays the shared picture muted beside the language sound track', async () => {
    void playCampaignMovie(MOVIE, LABELS);
    const video = surface().querySelector('video');
    expect(video?.getAttribute('src')).toBe(MOVIE.url);
    expect(video?.muted).toBe(true);
    expect(surface().querySelector('audio')?.getAttribute('src')).toBe(MOVIE.audio);
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
  });
});

describe('playCampaignMovie ending', () => {
  it('keeps the film, its picture on the last frame, until the longer sound ends', async () => {
    const done = playCampaignMovie(MOVIE, LABELS);
    const { video, sound } = tracks();
    endTrack(video);
    expect(await settled(done)).toBe(false);
    expect(video.isConnected).toBe(true);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    endTrack(sound);
    expect(await settled(done)).toBe(true);
  });

  it('keeps the film until the picture ends after a shorter sound', async () => {
    const done = playCampaignMovie(MOVIE, LABELS);
    const { video, sound } = tracks();
    endTrack(sound);
    expect(await settled(done)).toBe(false);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    endTrack(video);
    expect(await settled(done)).toBe(true);
  });

  it('ends both tracks at once on skip', async () => {
    const done = playCampaignMovie(MOVIE, LABELS);
    const { video, sound } = tracks();
    endTrack(video);
    surface().querySelectorAll<HTMLButtonElement>('.campaign-movie__controls button')[1]?.click();
    await done;
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect([video.hasAttribute('src'), sound.hasAttribute('src')]).toEqual([false, false]);
    expect(video.isConnected).toBe(false);
  });
});

describe('playCampaignMovie music', () => {
  it('restores the music when the viewer skips', async () => {
    const { silence, state } = silencer();
    const done = playCampaignMovie(MOVIE, LABELS, undefined, silence);
    expect(state).toEqual({ taken: 1, given: 0 });
    surface().querySelectorAll<HTMLButtonElement>('.campaign-movie__controls button')[1]?.click();
    await done;
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('restores the music when the film ends', async () => {
    const { silence, state } = silencer();
    const done = playCampaignMovie(MOVIE, LABELS, undefined, silence);
    const { video, sound } = tracks();
    endTrack(video);
    endTrack(sound);
    await done;
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('restores the music as soon as the film fails to load, and only once', async () => {
    const { silence, state } = silencer();
    const done = playCampaignMovie(MOVIE, LABELS, undefined, silence);
    surface().querySelector('video')?.dispatchEvent(new Event('error'));
    expect(state).toEqual({ taken: 1, given: 1 });
    surface().querySelectorAll<HTMLButtonElement>('.campaign-movie__controls button')[1]?.click();
    await done;
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('restores the music when the caller aborts', async () => {
    const { silence, state } = silencer();
    const abort = new AbortController();
    const done = playCampaignMovie(MOVIE, LABELS, abort.signal, silence);
    abort.abort();
    await done;
    expect(state).toEqual({ taken: 1, given: 1 });
  });

  it('leaves the music alone and shows nothing when there is no film to play', async () => {
    const { silence, state } = silencer();
    await playCampaignMovie(undefined, LABELS, undefined, silence);
    expect(document.querySelector('.campaign-movie')).toBeNull();
    expect(state).toEqual({ taken: 0, given: 0 });
  });
});

describe('playCampaignMovie picture failure', () => {
  it('stops the sound and keeps Play hidden when the picture fails during its pending start', async () => {
    const starts: ((error: DOMException) => void)[] = [];
    HTMLMediaElement.prototype.play = vi.fn(
      () => new Promise<void>((_resolve, reject) => starts.push(reject)),
    );
    const done = playCampaignMovie(MOVIE, LABELS);
    const { video } = tracks();
    const [play, skip] = surface().querySelectorAll<HTMLButtonElement>('.campaign-movie__controls button');
    video.dispatchEvent(new Event('error'));
    // The browser fires `error`, then rejects the pending start with NotSupportedError.
    for (const reject of starts) reject(new DOMException('no source', 'NotSupportedError'));
    expect(await settled(done)).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(play?.hidden).toBe(true);
    expect(document.activeElement).toBe(skip);
    expect(surface().querySelector('[role="status"]')?.textContent).toBe(LABELS.failed);
    skip?.click();
    expect(await settled(done)).toBe(true);
  });
});

describe('playCampaignMovie keyboard', () => {
  it('takes focus on a click inside it and keeps its keys from the page', async () => {
    const pageKeys: string[] = [];
    const onPageKey = (event: KeyboardEvent): void => {
      pageKeys.push(event.key);
    };
    window.addEventListener('keydown', onPageKey);
    try {
      const done = playCampaignMovie(MOVIE, LABELS);
      const dialog = surface();
      // A click on a non-focusable child focuses its nearest focusable ancestor: the surface.
      expect(dialog.tabIndex).toBe(-1);
      dialog.focus();
      expect(document.activeElement).toBe(dialog);
      for (const key of [' ', 'ArrowLeft', 'ArrowRight'])
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(pageKeys).toEqual([]);
      expect(await settled(done)).toBe(false);
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(pageKeys).toEqual([]);
      expect(await settled(done)).toBe(true);
    } finally {
      window.removeEventListener('keydown', onPageKey);
    }
  });
});

describe('movieClock', () => {
  it('reads whole minutes and padded seconds', () => {
    expect(movieClock(0)).toBe('0:00');
    expect(movieClock(65.9)).toBe('1:05');
    expect(movieClock(Number.NaN)).toBe('0:00');
  });
});

describe('seek bar visibility', () => {
  it('shows the bar on pointer movement over the film, not on a resting pointer, and hides it on leave', () => {
    vi.useFakeTimers();
    try {
      const { silence } = silencer();
      void playCampaignMovie(MOVIE, LABELS, undefined, silence);
      const frame = surface().querySelector('.campaign-movie__frame');
      if (!(frame instanceof HTMLElement)) throw new Error('no frame');
      const pointing = 'campaign-movie__frame--pointing';
      expect(frame.classList.contains(pointing)).toBe(false);
      frame.dispatchEvent(new Event('pointermove', { bubbles: true }));
      expect(frame.classList.contains(pointing)).toBe(true);
      vi.advanceTimersByTime(3000);
      expect(frame.classList.contains(pointing)).toBe(false);
      frame.dispatchEvent(new Event('pointermove', { bubbles: true }));
      frame.dispatchEvent(new Event('pointerleave'));
      expect(frame.classList.contains(pointing)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('playCampaignMovie subtitles', () => {
  const SRT =
    '1\n00:00:01,000 --> 00:00:03,500\nFirst line.\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line.\n';
  let lifetime: AbortController;
  beforeEach(() => {
    lifetime = new AbortController();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.load = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(SRT)),
    );
  });
  afterEach(() => {
    lifetime.abort();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });
  function start(visible = true, bilingual = false) {
    void playCampaignMovie(MOVIE, LABELS, lifetime.signal, undefined, {
      visible,
      tracks: [
        { language: 'eng', url: '/eng.srt' },
        ...(bilingual ? [{ language: 'chs' as const, url: '/chs.srt' }] : []),
      ],
    });
    const dialog = surface();
    const video = dialog.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    const box = dialog.querySelector('.campaign-movie__subtitles') as HTMLElement;
    const toggle = dialog.querySelector('.campaign-movie__captions') as HTMLButtonElement;
    const advance = (time: number) => {
      video.currentTime = time;
      video.dispatchEvent(new Event('timeupdate'));
    };
    return { dialog, box, toggle, advance };
  }
  it('starts same-language captions hidden and enables them with the button', async () => {
    const t = start(false);
    await vi.waitFor(() => expect(t.toggle.hidden).toBe(false));
    t.advance(2);
    expect(t.box.hidden).toBe(true);
    expect(t.toggle.getAttribute('aria-pressed')).toBe('false');
    expect(t.toggle.title).toBe('Subtitles (C)');
    t.toggle.click();
    expect(t.box.hidden).toBe(false);
    expect(t.box.textContent).toBe('First line.');
    expect(t.toggle.getAttribute('aria-pressed')).toBe('true');
    expect(t.toggle.title).toBe('Hide subtitles (C)');
    t.toggle.click();
    expect(t.box.hidden).toBe(true);
  });
  it('refreshes immediately when the keyboard re-enables captions after a seek', async () => {
    const t = start();
    await vi.waitFor(() => expect(t.box.hidden).toBe(false));
    t.advance(2);
    expect(t.box.textContent).toBe('First line.');
    t.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    t.advance(5);
    expect(t.box.hidden).toBe(true);
    t.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', bubbles: true }));
    expect(t.box.hidden).toBe(false);
    expect(t.box.textContent).toBe('Second line.');
  });
  it('keeps captions off when the second language arrives late', async () => {
    let complete: (response: Response) => void = () => {};
    const delayed = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => (url === '/chs.srt' ? delayed : Promise.resolve(new Response(SRT)))),
    );
    const t = start(true, true);
    await vi.waitFor(() => expect(t.box.hidden).toBe(false));
    t.advance(2);
    t.toggle.click();
    complete(new Response(SRT.replace('First line.', '译文')));
    await vi.waitFor(() =>
      expect(t.box.querySelector('[lang="zh-Hans"]')?.hasAttribute('hidden')).toBe(false),
    );
    expect(t.box.hidden).toBe(true);
    expect(t.toggle.getAttribute('aria-pressed')).toBe('false');
    expect(t.toggle.title).toBe('Subtitles (C)');
    t.toggle.click();
    expect(t.box.textContent).toBe('First line.译文');
  });
  it('returns pointer focus to the film but keeps keyboard activation on captions', async () => {
    const t = start();
    await vi.waitFor(() => expect(t.toggle.hidden).toBe(false));
    t.toggle.focus();
    t.toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(document.activeElement).toBe(t.dialog);
    t.toggle.focus();
    t.toggle.click();
    expect(document.activeElement).toBe(t.toggle);
  });
  it('tabs through the seek bar and captions, and skips both after video failure', async () => {
    const t = start();
    await vi.waitFor(() => expect(t.toggle.hidden).toBe(false));
    t.advance(2);
    const seek = t.dialog.querySelector('input');
    const skip = t.dialog.querySelectorAll<HTMLButtonElement>('.campaign-movie__controls button')[1];
    t.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(seek);
    t.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(t.toggle);
    t.dialog.querySelector('video')?.dispatchEvent(new Event('error'));
    t.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(skip);
  });
  it('aborts outstanding subtitle loads when the film closes', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    start();
    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    lifetime.abort();
    expect(options?.signal?.aborted).toBe(true);
  });
  it('leaves the film playing when a subtitle fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('no network');
      }),
    );
    const t = start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.box.hidden).toBe(true);
    expect(t.toggle.hidden).toBe(true);
    expect(t.dialog.isConnected).toBe(true);
  });
});
