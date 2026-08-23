# create-astro-daisy

[![npm version](https://img.shields.io/npm/v/create-astro-daisy.svg)](https://www.npmjs.com/package/create-astro-daisy)
[![license](https://img.shields.io/npm/l/create-astro-daisy.svg)](./LICENSE)

Scaffold an [Astro](https://astro.build) project pre-wired with [Tailwind CSS](https://tailwindcss.com) and [daisyUI](https://daisyui.com) — a thin wrapper around `create-astro@latest`.

```sh
npm create astro-daisy@latest
```

Every flag `npm create astro@latest` accepts (`--template`, `--add`, `--git`/`--no-git`, `--dry-run`, a directory positional, ...) is forwarded through untouched, so this behaves exactly like the official CLI, plus the steps below.

## What it does

1. Runs `create-astro@latest` with your arguments (dependency install is always forced — everything after this step needs `node_modules`).
2. Runs `astro add tailwind --yes` (Tailwind CSS v4, via the official Vite plugin).
3. Installs `daisyui` as a dev dependency and adds `@plugin "daisyui";` to your global stylesheet.
4. Asks whether to add an official Astro frontend framework — React, Preact, Svelte, Vue, SolidJS, or Alpine.js — and runs `astro add <framework>` if you pick one.
5. Asks whether to write MCP docs config (the free [Astro docs MCP server](https://docs.astro.build/en/guides/build-with-ai/) plus [Context7](https://context7.com), which covers current Tailwind/daisyUI docs too) for Claude Code, Cursor, and/or VS Code.

Steps 4 and 5 are skipped by default in non-interactive runs (CI, scripts) unless you pass their flags explicitly — they only prompt when run in a real terminal.

## Flags

These two flags belong to `create-astro-daisy` itself and are stripped before the rest of your arguments are forwarded to `create-astro`:

| Flag | Values | Description |
| --- | --- | --- |
| `--framework <name>` | `react`, `preact`, `svelte`, `vue`, `solid`, `alpinejs`, comma-separated, or `none` | Skip the interactive prompt and pick a framework (or none) up front. |
| `--mcp <targets>` | `claude`, `cursor`, `vscode`, comma-separated, `all`, or `none` | Skip the interactive prompt and pick which editor(s) get MCP docs config. |

### Examples

```sh
# fully interactive
npm create astro-daisy@latest my-app

# non-interactive, with React and no MCP config
npm create astro-daisy@latest my-app -- --template minimal --install --no-git --yes --framework react --mcp none

# any create-astro flag works too
npm create astro-daisy@latest my-app -- --template blog --add mdx
```

## Requirements

Node.js >= 18.18.0.

## Why not daisyUI Blueprint?

daisyUI's only MCP server ([Blueprint](https://daisyui.com/blueprint)) is a paid product that needs a license key, so it isn't wired in automatically. [Context7](https://context7.com) is free and covers current Tailwind/daisyUI documentation instead.

## Contributing

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning:

```sh
npm run changeset   # describe your change
npm run version     # bump package.json + CHANGELOG.md
npm run release      # publish to npm
```

## License

[MIT](./LICENSE) © Kacper Olszanski
