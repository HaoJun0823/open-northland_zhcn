import '../hud/dom/foundation.css';
import './movie.css';
import { type CampaignMovie, LANGUAGE_INFO, type MapTextLanguage } from '@open-northland/data';
import { syncMovieSound } from './movie-sync.js';
import { activeCue, type MovieSubtitles, parseSrt, type SubtitleCue } from './subtitles.js';

/** The original's film frame, used while a movie names no size of its own. */
const DEFAULT_MOVIE_WIDTH = 640;
const DEFAULT_MOVIE_HEIGHT = 480;
/** Height kept free below the frame for the play and skip buttons. */
const CONTROLS_RESERVE_PX = 64;
/** The seek bar's keyboard step. */
const SEEK_STEP_S = 1;
/** How long the seek bar stays after the pointer last moved over the film. */
const SEEK_LINGER_MS = 2500;
const POINTING_CLASS = 'campaign-movie__frame--pointing';
const SECONDS_PER_MINUTE = 60;

/** Display pixels, never enlarged. A small viewport shrinks both dimensions by the same factor. */
export function movieSize(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
): { width: number; height: number } {
  const scale = Math.max(0, Math.min(1, availableWidth / width, availableHeight / height));
  return { width: width * scale, height: height * scale };
}

/** `m:ss` of a film position; an unknown length reads as zero. */
export function movieClock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  return `${minutes}:${String(whole % SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

/** Silences the page's music at once and answers the call that brings it back. */
export type MusicSilencer = () => () => void;

/**
 * The music's silence over one film: taken once, given back once, whichever of end, skip, load failure
 * or cancellation comes first.
 */
export function movieMusicHold(silence: MusicSilencer | undefined): { release(): void } {
  let restore: (() => void) | null = silence?.() ?? null;
  return {
    release() {
      const pending = restore;
      restore = null;
      pending?.();
    },
  };
}

export interface MovieLabels {
  readonly skip: string;
  readonly play: string;
  readonly failed: string;
  readonly seek: string;
  readonly subtitles: string;
  readonly subtitlesOff: string;
}

/**
 * A blocking DOM movie surface; owns its media and listeners until end, skip or cancellation. The
 * silent picture and the language's sound track play as one film, until the longer of the two ends;
 * a picture that ends first holds its last frame. While it plays, `silenceMusic` holds the page's
 * music silent. A sequence without a film resolves at once.
 */
export function playCampaignMovie(
  movie: CampaignMovie | undefined,
  labels: MovieLabels,
  signal?: AbortSignal,
  silenceMusic?: MusicSilencer,
  subtitles?: MovieSubtitles,
): Promise<void> {
  if (movie === undefined || signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    const tracks: { readonly language: MapTextLanguage; readonly cues: readonly SubtitleCue[] }[] = [];
    let selectedTrack = 0;
    let languageChosen = false;
    let subtitlesHidden = !(subtitles?.visible ?? false);
    const subtitleRequest = new AbortController();
    const subtitleBox = document.createElement('div');
    subtitleBox.className = 'campaign-movie__subtitles';
    subtitleBox.hidden = true;
    const subtitleToggle = document.createElement('button');
    subtitleToggle.className = 'campaign-movie__captions';
    subtitleToggle.textContent = 'CC';
    subtitleToggle.setAttribute('aria-label', labels.subtitles);
    subtitleToggle.setAttribute('aria-keyshortcuts', 'C');
    subtitleToggle.hidden = true;
    const subtitleLanguage = document.createElement('button');
    subtitleLanguage.className = 'campaign-movie__captions campaign-movie__language';
    subtitleLanguage.hidden = true;
    subtitleLanguage.setAttribute('aria-haspopup', 'menu');
    subtitleLanguage.setAttribute('aria-expanded', 'false');
    const languageMenu = document.createElement('div');
    languageMenu.className = 'campaign-movie__languages';
    languageMenu.id = 'campaign-movie-languages';
    subtitleLanguage.setAttribute('aria-controls', languageMenu.id);
    languageMenu.setAttribute('role', 'menu');
    languageMenu.setAttribute('aria-label', labels.subtitles);
    languageMenu.hidden = true;
    const closeLanguages = (restoreFocus = false): void => {
      languageMenu.hidden = true;
      subtitleLanguage.setAttribute('aria-expanded', 'false');
      if (restoreFocus) subtitleLanguage.focus();
    };

    const line = document.createElement('div');
    line.className = 'campaign-movie__subtitle';
    subtitleBox.append(line);
    const showSubtitles = (time: number): void => {
      const track = tracks[selectedTrack];
      if (subtitlesHidden || track === undefined) return;
      line.lang = LANGUAGE_INFO[track.language].tag;
      line.textContent = activeCue(track.cues, time)?.text ?? '';
    };
    const showLanguage = (): void => {
      const track = tracks[selectedTrack];
      if (track === undefined) return;
      const tag = LANGUAGE_INFO[track.language].tag;
      subtitleLanguage.textContent = tag.split('-')[0]?.toUpperCase() ?? tag;
      const name = new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag;
      subtitleLanguage.title = `${labels.subtitles}: ${name}`;
      subtitleLanguage.setAttribute('aria-label', subtitleLanguage.title);
      for (const option of languageMenu.querySelectorAll('button')) {
        option.setAttribute('aria-checked', String(option.dataset.language === track.language));
      }
    };
    const setSubtitlesVisible = (visible: boolean): void => {
      subtitlesHidden = !visible;
      subtitleBox.hidden = !visible || tracks.length === 0;
      subtitleToggle.setAttribute('aria-pressed', String(visible));
      subtitleToggle.title = `${visible ? labels.subtitlesOff : labels.subtitles} (C)`;
      if (visible) showSubtitles(media.position());
    };
    // A slow alternative must not delay a ready track or undo the viewer's language choice.
    const requestedTracks = subtitles?.tracks ?? [];
    for (const track of requestedTracks) {
      void (async () => {
        try {
          const response = await fetch(track.url, { signal: subtitleRequest.signal });
          if (!response.ok) return;
          const cues = parseSrt(await response.text());
          if (cues.length === 0 || subtitleRequest.signal.aborted) return;
          const chosenLanguage = tracks[selectedTrack]?.language;
          tracks.push({ language: track.language, cues });
          tracks.sort(
            (a, b) =>
              requestedTracks.findIndex((entry) => entry.language === a.language) -
              requestedTracks.findIndex((entry) => entry.language === b.language),
          );
          selectedTrack = languageChosen
            ? Math.max(
                0,
                tracks.findIndex((entry) => entry.language === chosenLanguage),
              )
            : 0;
          subtitleToggle.hidden = false;
          subtitleLanguage.hidden = tracks.length < 2;
          const option = document.createElement('button');
          option.type = 'button';
          option.setAttribute('role', 'menuitemradio');
          option.dataset.language = track.language;
          const tag = LANGUAGE_INFO[track.language].tag;
          option.lang = tag;
          option.textContent = new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag;
          option.addEventListener('click', (event) => {
            languageChosen = true;
            selectedTrack = tracks.findIndex((entry) => entry.language === track.language);
            showLanguage();
            setSubtitlesVisible(true);
            closeLanguages(event.detail === 0);
            if (event.detail > 0) surface.focus({ preventScroll: true });
          });
          const nextTrack = tracks[tracks.findIndex((entry) => entry.language === track.language) + 1];
          const nextOption =
            nextTrack === undefined
              ? null
              : languageMenu.querySelector(`[data-language="${nextTrack.language}"]`);
          languageMenu.insertBefore(option, nextOption);
          showLanguage();
          setSubtitlesVisible(!subtitlesHidden);
        } catch {
          // Failed tracks are not offered; the film and other subtitles remain available.
        }
      })();
    }
    subtitleToggle.addEventListener('click', (event) => {
      setSubtitlesVisible(subtitlesHidden);
      // Pointer activation must not pin the bar if the viewer later uses the C shortcut.
      if (event.detail > 0) surface.focus({ preventScroll: true });
    });
    subtitleLanguage.addEventListener('click', () => {
      if (!languageMenu.hidden) {
        closeLanguages(true);
        return;
      }
      languageMenu.hidden = false;
      subtitleLanguage.setAttribute('aria-expanded', 'true');
      languageMenu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    });
    languageMenu.addEventListener('keydown', (event) => {
      const options = [...languageMenu.querySelectorAll('button')];
      const at = options.indexOf(document.activeElement as HTMLButtonElement);
      let next: number | undefined;
      if (event.key === 'ArrowDown') next = (at + 1) % options.length;
      if (event.key === 'ArrowUp') next = (at + options.length - 1) % options.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = options.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        options[next]?.focus();
      }
    });
    const surface = document.createElement('dialog');
    surface.className = 'campaign-movie';
    surface.setAttribute('role', 'dialog');
    surface.setAttribute('aria-modal', 'true');
    surface.setAttribute('aria-label', labels.play);
    // A click on the picture focuses the surface, not the page, so its keys stay out of the menu and game.
    surface.tabIndex = -1;
    const video = document.createElement('video');
    video.src = movie.url;
    video.playsInline = true;
    video.preload = 'auto';
    const sound = document.createElement('audio');
    sound.src = movie.audio;
    sound.preload = 'auto';
    // The film closes once both tracks have ended; `finish` is bound below.
    const media = syncMovieSound(video, sound, () => finish());
    const play = document.createElement('button');
    play.className = 'on-button';
    play.textContent = labels.play;
    play.hidden = true;
    const skip = document.createElement('button');
    skip.className = 'on-button';
    skip.textContent = labels.skip;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const controls = document.createElement('div');
    controls.className = 'campaign-movie__controls';
    controls.append(play, skip, status);
    const seek = document.createElement('input');
    seek.type = 'range';
    seek.className = 'campaign-movie__seek-range';
    seek.min = '0';
    seek.max = '0';
    seek.step = String(SEEK_STEP_S);
    seek.value = '0';
    seek.disabled = true;
    seek.setAttribute('aria-label', labels.seek);
    const clock = document.createElement('span');
    clock.className = 'campaign-movie__clock';
    const seekRow = document.createElement('div');
    seekRow.className = 'campaign-movie__seek';
    seekRow.append(seek, clock, subtitleToggle, subtitleLanguage, languageMenu);
    // The HUD scope lends the controls its tokens and button style; the black surface stays outside it.
    const frameHud = document.createElement('div');
    frameHud.className = 'on-hud';
    frameHud.append(seekRow);
    const frame = document.createElement('div');
    frame.className = 'campaign-movie__frame';
    frame.append(video, sound, subtitleBox, frameHud);
    // A pointer that merely rests where the film opened must not show the bar; a move does.
    let pointing: ReturnType<typeof setTimeout> | undefined;
    const stopPointing = (): void => {
      clearTimeout(pointing);
      pointing = undefined;
      frame.classList.remove(POINTING_CLASS);
    };
    frame.addEventListener('pointermove', () => {
      clearTimeout(pointing);
      frame.classList.add(POINTING_CLASS);
      pointing = setTimeout(stopPointing, SEEK_LINGER_MS);
    });
    frame.addEventListener('pointerleave', stopPointing);
    const hud = document.createElement('div');
    hud.className = 'on-hud';
    hud.append(controls);
    surface.append(frame, hud);
    const previousFocus = document.activeElement;
    const music = movieMusicHold(silenceMusic);
    let done = false;
    /** The picture could not load; only Skip remains. */
    let failed = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      subtitleRequest.abort();
      stopPointing();
      music.release();
      window.removeEventListener('resize', resize);
      signal?.removeEventListener('abort', finish);
      media.dispose();
      media.pause();
      for (const element of [video, sound]) {
        element.removeAttribute('src');
        element.load();
      }
      surface.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve();
    };
    const resize = (): void => {
      const size = movieSize(
        movie.width ?? DEFAULT_MOVIE_WIDTH,
        movie.height ?? DEFAULT_MOVIE_HEIGHT,
        window.innerWidth,
        Math.max(0, window.innerHeight - CONTROLS_RESERVE_PX),
      );
      frame.style.width = `${size.width}px`;
      frame.style.height = `${size.height}px`;
    };
    const showPosition = (): void => {
      const duration = media.duration();
      const position = Math.min(media.position(), duration);
      seek.disabled = duration <= 0;
      seek.max = String(duration);
      seek.value = String(position);
      seek.setAttribute('aria-valuetext', movieClock(position));
      const progress = duration > 0 ? (position / duration) * 100 : 0;
      seek.style.setProperty('--progress', `${progress}%`);
      clock.textContent = `${movieClock(position)} / ${movieClock(duration)}`;
      showSubtitles(position);
    };
    const attempt = (): void => {
      if (failed) return;
      play.hidden = true;
      void media.play().catch(() => {
        // A picture that failed to load rejects its pending start too; Play cannot help it.
        if (!done && !failed && video.error === null) {
          play.hidden = false;
          play.focus();
        }
      });
    };
    play.addEventListener('click', attempt);
    skip.addEventListener('click', finish);
    seek.addEventListener('input', () => {
      media.seek(Number(seek.value));
      showPosition();
    });
    for (const element of [video, sound])
      for (const type of ['loadedmetadata', 'durationchange', 'timeupdate'])
        element.addEventListener(type, showPosition);
    video.addEventListener('error', () => {
      if (done) return;
      failed = true;
      media.pause();
      music.release();
      status.textContent = labels.failed;
      play.hidden = true;
      seekRow.hidden = true;
      skip.focus();
    });
    surface.addEventListener('pointerdown', (event) => {
      if (
        event.target instanceof Node &&
        !languageMenu.contains(event.target) &&
        !subtitleLanguage.contains(event.target)
      )
        closeLanguages();
    });
    surface.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!languageMenu.hidden) closeLanguages(true);
      else finish();
    });
    surface.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!languageMenu.hidden) closeLanguages(true);
        else finish();
        return;
      }
      if (event.key === 'c' || event.key === 'C') {
        if (!subtitleToggle.hidden && !seekRow.hidden) {
          event.preventDefault();
          setSubtitlesVisible(subtitlesHidden);
        }
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        if (!languageMenu.hidden) closeLanguages(true);
        const order = [seek, subtitleToggle, subtitleLanguage, play, skip].filter(
          (control) =>
            !control.disabled &&
            !control.hidden &&
            !(
              (control === seek || control === subtitleToggle || control === subtitleLanguage) &&
              seekRow.hidden
            ),
        );
        const at = order.indexOf(document.activeElement as HTMLButtonElement | HTMLInputElement);
        const step = event.shiftKey ? order.length - 1 : 1;
        order[(at + step) % order.length]?.focus();
      }
    });
    signal?.addEventListener('abort', finish, { once: true });
    window.addEventListener('resize', resize);
    document.body.append(surface);
    surface.showModal();
    resize();
    showPosition();
    skip.focus();
    attempt();
  });
}
