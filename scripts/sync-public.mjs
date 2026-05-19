#!/usr/bin/env node
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDest = path.resolve(repoRoot, "..", "Time-Goalie-Public");

const allowlist = [
  ".env.example",
  ".gitignore",
  ".prettierrc",
  "README.md",
  "eslint.config.js",
  "index.html",
  "package-lock.json",
  "package.json",
  "playwright.config.js",
  "public",
  "scripts/dev-full.mjs",
  "scripts/sync-public.mjs",
  "server/index.mjs",
  "server/lib",
  "src",
  "tests",
  "vite.config.js",
  "vitest.config.js",
];

const forbiddenPatterns = [
  /^\.env($|\.(?!example$))/,
  /^dist($|\/)/,
  /^node_modules($|\/)/,
  /^playwright-report($|\/)/,
  /^server\/data($|\/)/,
  /^test-results($|\/)/,
  /(^|\/)\.DS_Store$/,
  /\.log$/,
  /\.zip$/,
];

function parseArgs(argv) {
  const options = { audit: false, dryRun: false, dest: defaultDest };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--audit") {
      options.audit = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--dest") {
      options.dest = path.resolve(argv[index + 1] ?? "");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isForbidden(relativePath) {
  return forbiddenPatterns.some((pattern) => pattern.test(toPosix(relativePath)));
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root, base = root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    const relative = path.relative(base, absolute);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolute, base)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

async function assertPublicRepo(dest) {
  if (!(await pathExists(path.join(dest, ".git")))) {
    throw new Error(`Refusing to sync: ${dest} does not look like the public git repo.`);
  }
}

async function cleanDest(dest, dryRun) {
  const entries = await readdir(dest, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const target = path.join(dest, entry.name);
    if (dryRun) {
      console.log(`[dry-run] remove ${path.relative(dest, target)}`);
    } else {
      await rm(target, { recursive: true, force: true });
    }
  }
}

async function copyAllowlist(dest, dryRun) {
  for (const item of allowlist) {
    const source = path.join(repoRoot, item);
    if (!(await pathExists(source))) continue;
    const target = path.join(dest, item);
    if (dryRun) {
      console.log(`[dry-run] copy ${item}`);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
}

async function auditDest(dest) {
  const files = await walkFiles(dest);
  const publicFiles = files.filter((file) => !toPosix(file).startsWith(".git/")).sort();
  const forbidden = publicFiles.filter(isForbidden);

  console.log(`Public files: ${publicFiles.length}`);
  if (forbidden.length > 0) {
    console.error("Forbidden public files:");
    for (const file of forbidden) console.error(`- ${file}`);
    process.exitCode = 1;
    return;
  }
  console.log("Forbidden files: 0");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await assertPublicRepo(options.dest);

  if (!options.audit) {
    await cleanDest(options.dest, options.dryRun);
    await copyAllowlist(options.dest, options.dryRun);
  }

  if (!options.dryRun) {
    await auditDest(options.dest);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
