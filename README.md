<h1 align="center">
  <img src="docs/images/logo.webp" alt="Open Northland" width="320">
</h1>

[![CI](https://github.com/s-nems/open-northland/actions/workflows/ci.yml/badge.svg)](https://github.com/s-nems/open-northland/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](LICENSE)

Open Northland is an independent, cross-platform engine for *Cultures - 8th Wonder of the World*, a
Viking-era strategy game. It combines a deterministic TypeScript simulation, a PixiJS renderer, and
an offline asset pipeline.

The repository contains no original game files or decoded content. The maps, graphics, and audio
the engine plays come from the original game, converted locally from the Open Northland data pack.
Playing requires an installed original: *Cultures 2*, *Cultures: Northland* or *Cultures - 8th
Wonder of the World* from disc, [Steam](https://store.steampowered.com/app/351870/),
[GOG](https://www.gog.com/game/cultures_34) or the Mac App Store; the game checks for one at first
start (see `docs/LEGAL.md`).

You can play-test it from: [game.opennorthland.org](https://game.opennorthland.org)

![A settlement rendered by Open Northland from decoded game data](docs/images/settlement.webp)

## Status

Open Northland is in alpha. The current build has a playable settlement economy, building,
gathering, production, progression, combat, fog, population systems, and a basic computer player.
It can load decoded maps and render terrain, buildings, settlers, effects, and the HUD.

## Requirements

- Node.js `>=22.12.0`
- For playable content, the pinned Open Northland source pack (`data.zip`), which the first
  `npm run dev` downloads and converts after asking.

## Starting the project

```bash
npm ci
npm run dev
```

The first `npm run dev` (or `npm run build`) describes the data pack, asks before downloading it,
verifies its SHA-256 and converts it into `content/`. Later runs skip this while the pack and the
content format version are unchanged; `npm run build:content` rebuilds it anyway, for example after
a pipeline fix. To convert a local copy of the archive instead of downloading, set `ON_DATA_ZIP` in
`.env`. `docs/DEVELOPMENT.md` covers the cache, runs without a terminal and the pipeline itself.

Tests and checks:

```bash
npm test
npm run check
```

Converted content is ignored by Git. Never commit it; it remains the property of its rights holders
(see `docs/LEGAL.md`).

## Repository layout

```text
packages/
  app/               Browser shell, input, menus, HUD, and scenes
  art-contracts/     Shape contract of the delivered HUD chrome
  audio/             Sound selection and Web Audio playback
  data/              Validated schemas and content loaders
  desktop/           Electron shell serving the app and the converted content
  lockstep/          Session driver: when a tick runs and which commands it carries
  net-client/        One client of a relayed session
  net-protocol/      Lockstep wire protocol
  net-server/        Multiplayer relay
  render/            PixiJS isometric renderer
  sim/               Deterministic simulation
tools/
  asset-pipeline/    Converts the Open Northland data pack into the served content tree
deploy/web/          nginx image of the built app and the converted content
scripts/             Repository checks, content build, benchmarks
content/             Converted locally, ignored by Git
docs/                Design notes, format research, and open tickets
```

Start with the [documentation index](docs/README.md) for the design and data flow.

## Working in the repository

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Coding agents must also
read [`AGENTS.md`](AGENTS.md).

## License and trademarks

Open Northland, including its HUD chrome, logo and icons, is licensed under AGPL-3.0-or-later. See
[`LICENSE`](LICENSE).

This is an independent project. It is not affiliated with or endorsed by Funatics Software, Daedalic
Entertainment, or another rights holder of the *Cultures* series. Game names are used only to
describe compatibility. The full notice is in [`docs/LEGAL.md`](docs/LEGAL.md).
