#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);

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

async function main() {
  console.log(
    "create-astro-daisy: scaffolding via create-astro, then adding Tailwind + daisyUI\n",
  );

  const cwd = process.cwd();
  const entriesBefore = new Set(readdirSync(cwd));

  const code = await run("npx", ["--yes", "create-astro@latest", ...args]);
  if (code !== 0) process.exit(code);

  if (args.includes("--dry-run")) {
    console.log("\n--dry-run: skipping Tailwind/daisyUI setup.");
    return;
  }

  const projectDir = findProjectDir(args, cwd, entriesBefore);
  if (!projectDir) {
    console.log(
      "\ncreate-astro-daisy: could not determine project directory, skipping Tailwind/daisyUI setup.",
    );
    console.log(
      'Run manually inside your project: npx astro add tailwind && npm install -D daisyui, then add `@plugin "daisyui";` under the tailwindcss import in your global CSS.',
    );
    return;
  }
  const projectDirName = relative(cwd, projectDir) || ".";

  if (!existsSync(join(projectDir, "node_modules"))) {
    console.log(
      "\ncreate-astro-daisy: dependencies were not installed (--no-install?), skipping Tailwind/daisyUI setup.",
    );
    console.log(
      `cd ${projectDirName} && npm install && npx astro add tailwind && npm install -D daisyui, then add \`@plugin "daisyui";\` under the tailwindcss import in your global CSS.`,
    );
    return;
  }

  console.log("\ncreate-astro-daisy: adding Tailwind CSS...");
  const tailwindCode = await run(
    "npx",
    ["--yes", "astro", "add", "tailwind", "--yes"],
    { cwd: projectDir },
  );
  if (tailwindCode !== 0) {
    console.log(
      "create-astro-daisy: `astro add tailwind` failed, skipping daisyUI setup.",
    );
    process.exit(tailwindCode);
  }

  const pm = detectPackageManager(projectDir) ?? "npm";
  console.log(`\ncreate-astro-daisy: installing daisyUI with ${pm}...`);
  const installCode = await run(pm, DEV_INSTALL[pm], { cwd: projectDir });
  if (installCode !== 0) {
    console.log("create-astro-daisy: daisyUI install failed.");
    process.exit(installCode);
  }

  const wired = wireDaisyUiIntoCss(projectDir);
  if (!wired) {
    console.log(
      '\ncreate-astro-daisy: could not find a stylesheet importing "tailwindcss" to wire daisyUI into.',
    );
    console.log(
      'Add `@plugin "daisyui";` under `@import "tailwindcss";` in your global CSS manually.',
    );
  }

  console.log(`\ncreate-astro-daisy: done! Tailwind CSS + daisyUI are ready.`);
  console.log(`  cd ${projectDirName}`);
  console.log(`  ${pm} run dev`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
