# @kanabun/cli

The `kanabun` command for [kanabun](https://github.com/ocknamo/kanabun) —
scaffold, develop, and build apps. This is the Bun-dependent layer of the
framework (the only place Bun / Node APIs are used); `@kanabun/core` stays
runtime-independent.

## Install

```sh
bun add -d @kanabun/cli
```

## Usage

```sh
kanabun create my-app                 # scaffold a new app
kanabun dev      index.html           # dev server with reload on change
kanabun build    index.html --outdir dist   # production bundle
kanabun generate                      # static site generation (SSG)
```

## Commands

- **create** — scaffold a new kanabun app.
- **dev** — dev server with full reload on change.
- **build** — bundle for the browser (`--no-sourcemap` skips the sourcemap).
- **generate** — static site generation.
- **preview** / **serve** — preview a built app, incl. SSR.
- **lint** — kanabun-aware linting.

## License

MIT
