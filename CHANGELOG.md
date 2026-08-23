# create-astro-daisy

## 0.2.0

### Minor Changes

- Initial `create-astro-daisy` CLI: wraps `create-astro@latest`, forwarding all of its flags untouched, then wires up Tailwind CSS and daisyUI automatically. Adds optional official Astro frontend framework selection (React, Preact, Svelte, Vue, SolidJS, Alpine.js) and optional MCP docs config (Astro docs + Context7) for Claude Code, Cursor, and VS Code, both prompted interactively via `@inquirer/prompts` after the core scaffold is ready. Dependency install is always forced so the rest of the pipeline has `node_modules` to work with.
