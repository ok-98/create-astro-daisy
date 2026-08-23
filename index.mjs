#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import chalk from "chalk";

const args = process.argv.slice(2);

const log = {
  step: (msg) => console.log(chalk.cyan(`\n→ ${msg}`)),
  success: (msg) => console.log(chalk.green(`✔ ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`⚠ ${msg}`)),
  error: (msg) => console.log(chalk.red(`✖ ${msg}`)),
  hint: (msg) => console.log(chalk.dim(msg)),
};

// --mcp and --framework are our own flags, not create-astro's — pull them out
// before forwarding the rest of argv untouched.
function extractFlag(argv, name) {
  const flag = `--${name}`;
  const idx = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (idx === -1) return { value: null, rest: argv };
  const rest = [...argv];
  let value;
  if (argv[idx].startsWith(`${flag}=`)) {
    value = argv[idx].slice(flag.length + 1);
    rest.splice(idx, 1);
  } else {
    value = argv[idx + 1];
    rest.splice(idx, 2);
  }
  return { value, rest };
}

function run(command, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, cmdArgs, {
      stdio: "inherit",
      shell: true,
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// create-astro's own success text isn't stable enough to regex reliably, and
// capturing its stdout to parse it breaks TTY passthrough for its prompts
// (see console-garbling issue). Instead, diff the directory listing: it's
// ground truth regardless of which flags were used or how the CLI's output
// is worded.
function findProjectDir(argv, cwd, entriesBefore) {
  if (argv.includes(".")) return cwd; // scaffolded in place

  const entriesAfter = readdirSync(cwd, { withFileTypes: true });
  const newDirs = entriesAfter.filter(
    (e) => e.isDirectory() && !entriesBefore.has(e.name),
  );
  if (newDirs.length !== 1) return null;

  const candidate = join(cwd, newDirs[0].name);
  // Guard against nested targets (e.g. `foo/bar`), where the top-level diff
  // only sees `foo`. Only trust the candidate if it's an actual project root.
  return existsSync(join(candidate, "package.json")) ? candidate : null;
}

function detectPackageManager(dir) {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock")))
    return "bun";
  if (existsSync(join(dir, "package-lock.json"))) return "npm";
  return null;
}

const DEV_INSTALL = {
  npm: ["install", "-D", "daisyui@latest"],
  pnpm: ["add", "-D", "daisyui@latest"],
  yarn: ["add", "-D", "daisyui@latest"],
  bun: ["add", "-d", "daisyui@latest"],
};

function findCssFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      results.push(...findCssFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      results.push(full);
    }
  }
  return results;
}

function wireDaisyUiIntoCss(projectDir) {
  const srcDir = join(projectDir, "src");
  if (!existsSync(srcDir)) return false;
  for (const file of findCssFiles(srcDir)) {
    const content = readFileSync(file, "utf8");
    if (!/@import\s+["']tailwindcss["']/.test(content)) continue;
    if (content.includes('@plugin "daisyui"')) return true;
    const updated = content.replace(
      /@import\s+["']tailwindcss["'];?/,
      (m) => `${m}\n@plugin "daisyui";`,
    );
    writeFileSync(file, updated);
    return true;
  }
  return false;
}

// Astro docs has a free, keyless official MCP server. Tailwind has no MCP
// server. daisyUI's only MCP server (Blueprint) is a paid product needing a
// license key we don't have — Context7 (which this session itself uses)
// covers current Tailwind/daisyUI docs for free instead.
const DOCS_SERVERS = {
  "astro-docs": "https://mcp.docs.astro.build/mcp",
  context7: "https://mcp.context7.com/mcp",
};

function writeMcpConfig(projectDir, relPath, topKey, buildEntry) {
  const filePath = join(projectDir, relPath);
  let existing = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      existing = {};
    }
  }
  const servers = Object.fromEntries(
    Object.entries(DOCS_SERVERS).map(([name, url]) => [name, buildEntry(url)]),
  );
  existing[topKey] = { ...existing[topKey], ...servers };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n");
}

const MCP_LABELS = {
  claude: "Claude Code (.mcp.json)",
  cursor: "Cursor (.cursor/mcp.json)",
  vscode: "VS Code (.vscode/mcp.json)",
};
const MCP_WRITERS = {
  claude: (dir) =>
    writeMcpConfig(dir, ".mcp.json", "mcpServers", (url) => ({
      type: "http",
      url,
    })),
  cursor: (dir) =>
    writeMcpConfig(dir, join(".cursor", "mcp.json"), "mcpServers", (url) => ({
      url,
    })),
  vscode: (dir) =>
    writeMcpConfig(dir, join(".vscode", "mcp.json"), "servers", (url) => ({
      type: "http",
      url,
    })),
};
const MCP_TARGETS = Object.keys(MCP_WRITERS);

async function resolveMcpTargets(flagValue) {
  if (flagValue) {
    if (flagValue === "none") return [];
    if (flagValue === "all") return MCP_TARGETS;
    return flagValue.split(",").filter((t) => MCP_TARGETS.includes(t));
  }
  if (!process.stdin.isTTY) return MCP_TARGETS; // non-interactive: harmless to write all

  const targets = await checkbox({
    message: "Add MCP docs config (Astro docs + Context7) for:",
    choices: [
      ...MCP_TARGETS.map((t) => ({
        name: MCP_LABELS[t],
        value: t,
        checked: true,
      })),
      { name: "None", value: "none", checked: false },
    ],
  });
  return targets.includes("none") ? [] : targets;
}

// Official Astro UI framework integrations, per
// https://docs.astro.build/en/guides/framework-components/
const FRAMEWORK_NAMES = ["react", "preact", "svelte", "vue", "solid", "alpinejs"];
const FRAMEWORK_LABELS = {
  react: "React",
  preact: "Preact",
  svelte: "Svelte",
  vue: "Vue",
  solid: "SolidJS",
  alpinejs: "Alpine.js",
};

async function resolveFrameworks(flagValue) {
  if (flagValue) {
    if (flagValue === "none") return [];
    return flagValue.split(",").filter((f) => FRAMEWORK_NAMES.includes(f));
  }
  if (!process.stdin.isTTY) return []; // non-interactive: don't surprise-add a framework

  const framework = await select({
    message: "Add an official frontend framework to Astro?",
    choices: [
      { name: "None", value: null },
      ...FRAMEWORK_NAMES.map((f) => ({ name: FRAMEWORK_LABELS[f], value: f })),
    ],
  });
  return framework ? [framework] : [];
}

async function main() {
  console.log(chalk.bold.magenta("create-astro-daisy"));
  log.hint(
    "Scaffolding via create-astro, then wiring up Tailwind CSS + daisyUI.",
  );

  const { value: mcpFlagValue, rest: afterMcp } = extractFlag(args, "mcp");
  const { value: frameworkFlagValue, rest: afterFramework } = extractFlag(
    afterMcp,
    "framework",
  );

  // Everything past this point needs node_modules (astro add, daisyui
  // install) — force dependency install regardless of what was passed.
  const forwardArgs = afterFramework.filter((a) => a !== "--no-install");
  if (afterFramework.length !== forwardArgs.length) {
    log.warn("Ignoring --no-install: Tailwind/daisyUI setup needs dependencies installed.");
  }
  if (!forwardArgs.includes("--install")) forwardArgs.push("--install");

  const cwd = process.cwd();
  const entriesBefore = new Set(readdirSync(cwd));

  const code = await run("npx", [
    "--yes",
    "create-astro@latest",
    ...forwardArgs,
  ]);
  if (code !== 0) process.exit(code);

  if (forwardArgs.includes("--dry-run")) {
    log.warn("--dry-run: skipping Tailwind/daisyUI/framework/MCP setup.");
    return;
  }

  const projectDir = findProjectDir(forwardArgs, cwd, entriesBefore);
  if (!projectDir) {
    log.warn(
      "Could not determine project directory, skipping Tailwind/daisyUI/framework/MCP setup.",
    );
    log.hint(
      'Run manually inside your project: npx astro add tailwind && npm install -D daisyui, then add `@plugin "daisyui";` under the tailwindcss import in your global CSS.',
    );
    return;
  }
  const projectDirName = relative(cwd, projectDir) || ".";

  if (!existsSync(join(projectDir, "node_modules"))) {
    log.warn(
      "Dependencies were not installed (--no-install?), skipping Tailwind/daisyUI/framework/MCP setup.",
    );
    log.hint(
      `cd ${projectDirName} && npm install && npx astro add tailwind && npm install -D daisyui, then add \`@plugin "daisyui";\` under the tailwindcss import in your global CSS.`,
    );
    return;
  }

  log.step("Adding Tailwind CSS...");
  const tailwindCode = await run(
    "npx",
    ["--yes", "astro", "add", "tailwind", "--yes"],
    { cwd: projectDir },
  );
  if (tailwindCode !== 0) {
    log.error("`astro add tailwind` failed, skipping daisyUI setup.");
    process.exit(tailwindCode);
  }

  const pm = detectPackageManager(projectDir) ?? "npm";
  log.step(`Installing daisyUI with ${pm}...`);
  const installCode = await run(pm, DEV_INSTALL[pm], { cwd: projectDir });
  if (installCode !== 0) {
    log.error("daisyUI install failed.");
    process.exit(installCode);
  }

  const wired = wireDaisyUiIntoCss(projectDir);
  if (wired) {
    log.success("Wired daisyUI into your global stylesheet.");
  } else {
    log.warn(
      'Could not find a stylesheet importing "tailwindcss" to wire daisyUI into.',
    );
    log.hint(
      'Add `@plugin "daisyui";` under `@import "tailwindcss";` in your global CSS manually.',
    );
  }

  // Nice-to-haves last, once the core scaffold is done and working.
  const frameworks = await resolveFrameworks(frameworkFlagValue);
  if (frameworks.length) {
    const labels = frameworks.map((f) => FRAMEWORK_LABELS[f]).join(", ");
    log.step(`Adding ${labels}...`);
    const frameworkCode = await run(
      "npx",
      ["--yes", "astro", "add", ...frameworks, "--yes"],
      { cwd: projectDir },
    );
    if (frameworkCode !== 0) {
      log.error(
        `Adding ${labels} failed — retry with \`npx astro add <name>\`.`,
      );
    } else {
      log.success(`Added ${labels}.`);
    }
  }

  const mcpTargets = await resolveMcpTargets(mcpFlagValue);
  if (mcpTargets.length) {
    for (const target of mcpTargets) MCP_WRITERS[target](projectDir);
    log.success(
      `Wrote MCP docs config for: ${mcpTargets.map((t) => MCP_LABELS[t]).join(", ")}`,
    );
  }

  console.log(chalk.bold.green("\n✔ Done! Tailwind CSS + daisyUI are ready."));
  console.log(chalk.cyan(`  cd ${projectDirName}`));
  console.log(chalk.cyan(`  ${pm} run dev`));
}

main().catch((err) => {
  console.error(chalk.red(err));
  process.exit(1);
});
