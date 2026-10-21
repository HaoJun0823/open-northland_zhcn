import {
  type Campaign,
  type CampaignLanguageMovies,
  type CampaignMovie,
  LANGUAGE_INFO,
  type LocalizedText,
  MAP_TEXT_LANGUAGES,
  type MapTextLanguage,
} from '@open-northland/data';
import { type Locale, mapTextLanguage } from '../i18n/index.js';

/** Campaign content with none of the reader's languages falls back to English, then to the first it has. */
const FALLBACK_LANGUAGE: MapTextLanguage = 'eng';
const NO_MOVIES: CampaignLanguageMovies = { videos: [] };
/** The script video the last stage's win requests; the shipped campaigns have no other. */
const FINALE_SEQUENCE = 0;

/** The reader's language, else the first of its registry fallbacks the content carries, else English,
 *  else the first language it has. */
function fallbackLanguage(
  present: readonly MapTextLanguage[],
  requested: MapTextLanguage,
): MapTextLanguage | undefined {
  const own = [requested, ...(LANGUAGE_INFO[requested].fallbacks ?? [])];
  return (
    own.find((language) => present.includes(language)) ??
    (present.includes(FALLBACK_LANGUAGE) ? FALLBACK_LANGUAGE : present[0])
  );
}

function presentIn(record: Partial<Record<MapTextLanguage, unknown>>): MapTextLanguage[] {
  return MAP_TEXT_LANGUAGES.filter((language) => record[language] !== undefined);
}

/** The text language a campaign plays in for a UI locale. */
export function campaignLanguage(campaign: Pick<Campaign, 'languages'>, locale: Locale): MapTextLanguage {
  return fallbackLanguage(campaign.languages, mapTextLanguage(locale)) ?? FALLBACK_LANGUAGE;
}

export function localizedText(text: LocalizedText, language: MapTextLanguage): string {
  const chosen = fallbackLanguage(presentIn(text), language);
  return (chosen === undefined ? undefined : text[chosen]) ?? '';
}

/** The campaign's title artwork in a language, falling back like texts; `undefined` without artwork. */
export function campaignLogo(
  campaign: Pick<Campaign, 'logo'>,
  language: MapTextLanguage,
): string | undefined {
  const { logo } = campaign;
  if (logo === undefined) return undefined;
  const chosen = fallbackLanguage(presentIn(logo), language);
  return chosen === undefined ? undefined : logo[chosen];
}

export function campaignMovies(
  campaign: Pick<Campaign, 'movies'>,
  language: MapTextLanguage,
): CampaignLanguageMovies {
  const chosen = fallbackLanguage(presentIn(campaign.movies), language);
  return (chosen === undefined ? undefined : campaign.movies[chosen]) ?? NO_MOVIES;
}

/** The language key whose films `campaignMovies` selected: the played sound track's language. */
export function campaignMovieLanguage(
  campaign: Pick<Campaign, 'movies'>,
  language: MapTextLanguage,
): MapTextLanguage | undefined {
  return fallbackLanguage(presentIn(campaign.movies), language);
}

/** The finale in a language, falling back like the other films; `undefined` without one. */
export function campaignFinale(
  campaign: Pick<Campaign, 'movies'>,
  language: MapTextLanguage,
): CampaignMovie | undefined {
  return campaignMovies(campaign, language).videos.find((movie) => movie.sequence === FINALE_SEQUENCE);
}
