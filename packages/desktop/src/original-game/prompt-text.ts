/** The wording of the dialog shown when no original installation is found. */
export interface OriginalGamePromptText {
  readonly title: string;
  readonly message: string;
  readonly pick: string;
  readonly buy: string;
  readonly quit: string;
  readonly notRecognized: string;
  readonly back: string;
}

const POLISH: OriginalGamePromptText = {
  title: 'Open Northland',
  message:
    'Do gry potrzebna jest zainstalowana oryginalna gra Cultures 2, Cultures: Northland lub Cultures - 8th Wonder of the World.',
  pick: 'Wskaż folder gry',
  buy: 'Gdzie kupić',
  quit: 'Zamknij',
  notRecognized: 'W tym folderze nie ma danych gry Cultures',
  back: 'Wróć',
};

const ENGLISH: OriginalGamePromptText = {
  title: 'Open Northland',
  message:
    'The game needs an installed original Cultures 2, Cultures: Northland or Cultures - 8th Wonder of the World.',
  pick: 'Pick the game folder',
  buy: 'Where to buy',
  quit: 'Quit',
  notRecognized: 'That folder holds no Cultures game data',
  back: 'Back',
};

/** Polish for a Polish system, English otherwise. */
export function originalGamePromptFor(systemLocale: string): OriginalGamePromptText {
  return systemLocale.split('-')[0]?.toLowerCase() === 'pl' ? POLISH : ENGLISH;
}
