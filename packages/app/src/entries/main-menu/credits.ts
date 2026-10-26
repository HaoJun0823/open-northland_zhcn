import culturesNationLogo from '../../assets/community/culturesnation.webp';
import discordMark from '../../assets/community/discord.svg';
import { GAME_VERSION } from '../../build-version.js';
import { openBugReportForm } from '../../diag/report/flow.js';
import { messages } from '../../i18n/index.js';
import { BRAND_LOGO_STACKED, BRAND_LOGO_STACKED_SIZE } from '../../view/boot/brand-art.js';
import { node } from './dom.js';
import type { MenuScreen } from './model.js';
import { screenHead } from './screen-head.js';

/** The author's public name; the project credits a handle, not a legal name. */
const AUTHOR = 'Space';
const COPYRIGHT_YEARS = '2026';
const CONTACT_EMAIL = 'contact@opennorthland.org';
const REPO_URL = 'https://github.com/s-nems/open-northland';
const ISSUES_URL = `${REPO_URL}/issues`;
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
/** The notices of the third-party code in the program; the builds also ship them as `licenses/`. */
const THIRD_PARTY_URL = `${REPO_URL}/blob/main/packages/app/public/licenses/THIRD-PARTY-NOTICES.txt`;
const DISCORD_URL = 'https://discord.gg/MYtDK2C';
const CULTURES_NATION_URL = 'https://culturesnation.pl/';

function externalLink(label: string, href: string, className: string): HTMLAnchorElement {
  const link = node('a', className, label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

function panel(title: string): HTMLElement {
  const box = node('article', 'main-menu__about-panel');
  box.append(node('h2', 'main-menu__about-panel-title', title));
  return box;
}

function thanksEntry(name: string, detail: string, href?: string): HTMLLIElement {
  const entry = node('li', 'main-menu__about-thanks');
  const heading =
    href === undefined
      ? node('span', 'main-menu__about-thanks-name', name)
      : externalLink(name, href, 'main-menu__about-thanks-name is-link');
  entry.append(heading, node('span', 'main-menu__about-thanks-detail', detail));
  return entry;
}

/** A community card in the website's style: the destination's mark beside its name and purpose. */
function destination(
  name: string,
  detail: string,
  href: string,
  art: string,
  artClass: string,
): HTMLAnchorElement {
  const card = externalLink('', href, 'main-menu__about-destination');
  const figure = node('span', `main-menu__about-destination-art ${artClass}`);
  const image = node('img');
  image.src = art;
  image.alt = '';
  image.decoding = 'async';
  figure.append(image);
  const copy = node('span', 'main-menu__about-destination-copy');
  copy.append(node('strong', '', name), node('span', '', detail));
  card.append(figure, copy);
  return card;
}

function authorPanel(): HTMLElement {
  const copy = messages().mainMenu.credits;
  const box = panel(copy.authorTitle);
  const author = node('div', 'main-menu__about-author');
  author.append(
    node('span', 'main-menu__about-author-name', AUTHOR),
    node('span', 'main-menu__about-role', copy.authorRole),
  );

  const contact = node('div', 'main-menu__about-contact');
  const mail = externalLink(CONTACT_EMAIL, `mailto:${CONTACT_EMAIL}`, 'main-menu__about-mail');
  const actions = node('div', 'main-menu__about-actions');
  const report = node('button', 'main-menu__ghost is-accent', copy.reportLink);
  report.type = 'button';
  report.addEventListener('click', openBugReportForm);
  actions.append(
    report,
    externalLink(copy.issuesLink, ISSUES_URL, 'main-menu__ghost'),
    externalLink(copy.sourceLink, REPO_URL, 'main-menu__ghost'),
  );
  contact.append(node('h3', 'main-menu__about-subtitle', copy.contactTitle), mail, actions);
  box.append(author, contact);
  return box;
}

function thanksPanel(): HTMLElement {
  const copy = messages().mainMenu.credits;
  const box = panel(copy.thanksTitle);
  const list = node('ul', 'main-menu__about-thanks-list');
  const { funatics, cnmod, community } = copy.thanks;
  list.append(
    thanksEntry(funatics.name, funatics.detail),
    thanksEntry(cnmod.name, cnmod.detail),
    thanksEntry(community.name, community.detail, CULTURES_NATION_URL),
  );
  box.append(list);
  return box;
}

function communityPanel(): HTMLElement {
  const copy = messages().mainMenu.credits;
  const box = panel(copy.communityTitle);
  box.append(
    destination('Discord CulturesNation', copy.discordDetail, DISCORD_URL, discordMark, 'is-discord'),
    destination('CulturesNation.pl', copy.culturesNationDetail, CULTURES_NATION_URL, culturesNationLogo, ''),
  );
  return box;
}

/** The copyright, no-warranty and license notice AGPL section 5(d) asks an interactive interface to show,
 *  with the third-party notices beside the license. */
function legalNotice(): HTMLElement {
  const copy = messages().mainMenu.credits;
  const legal = node('footer', 'main-menu__about-legal');
  const license = node('p', '');
  license.append(
    `© ${COPYRIGHT_YEARS} ${AUTHOR} · ${copy.license} `,
    externalLink(copy.licenseLink, LICENSE_URL, 'main-menu__about-legal-link'),
    ' · ',
    externalLink(copy.thirdPartyLink, THIRD_PARTY_URL, 'main-menu__about-legal-link'),
    ` · alpha ${GAME_VERSION}`,
  );
  legal.append(license, node('p', '', copy.disclaimer));
  return legal;
}

export function creditsScreen(open: (screen: MenuScreen) => void): HTMLElement {
  const copy = messages().mainMenu.credits;
  const section = node('section', 'main-menu__screen');

  const hero = node('div', 'main-menu__about-hero');
  const logo = node('img', 'main-menu__about-logo');
  logo.src = BRAND_LOGO_STACKED;
  logo.alt = 'Open Northland';
  logo.width = BRAND_LOGO_STACKED_SIZE.width;
  logo.height = BRAND_LOGO_STACKED_SIZE.height;
  logo.decoding = 'async';
  hero.append(logo, node('p', 'main-menu__about-intro', copy.intro));

  const panels = node('div', 'main-menu__about-panels');
  panels.append(authorPanel(), thanksPanel(), communityPanel());

  const body = node('div', 'main-menu__about');
  body.append(hero, panels, legalNotice());
  section.append(screenHead('credits', open), body);
  return section;
}
