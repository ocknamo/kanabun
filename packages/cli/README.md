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
- **dev** — dev server with full reload on change. Listens on loopback (`127.0.0.1`);
  pass `--host 0.0.0.0` to reach it from other devices on a network you trust.
  Dotfiles (`.env`, `.git/`) are never served.
- **build** — bundle for the browser (`--no-sourcemap` skips the sourcemap).
- **generate** — static site generation.
- **preview** / **serve** — preview a built app, incl. SSR. `preview` listens on
  loopback like `dev`; `serve` listens on every interface (it is what a
  deployment runs). Both take `--host`.
- **lint** — kanabun-aware linting.

## License

MIT
