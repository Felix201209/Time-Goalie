#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSnapshot, configFromEnv } from "../server/lib/homework.mjs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const noSync = args.has("--no-sync");
const config = configFromEnv();
const vaultPath = process.env.HOMEWORK_VAULT_PATH || "/Users/felix/Desktop/Codex's Workspace/Homework Vault";
const managebacSync =
  process.env.MANAGEBAC_SYNC_SCRIPT || path.join(vaultPath, "scripts", "managebac_sync.py");
const syncUrl = process.env.HOMEWORK_GOALIE_SYNC_URL || "http://127.0.0.1:4588/sync";
const outputFile =
  process.env.HOMEWORK_GOALIE_SNAPSHOT_OUT || path.join(process.cwd(), "tmp", "homework-snapshot.json");

if (!noSync) {
  const result = spawnSync("python3", [managebacSync, "--quiet"], {
    encoding: "utf8",
    stdio: dryRun ? "inherit" : "pipe",
    timeout: 240_000,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`ManageBac sync failed: ${output || result.status}`);
  }
}

const snapshot = await buildSnapshot({ vaultPath });
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(snapshot, null, 2)}\n`);

if (dryRun) {
  console.log(
    JSON.stringify(
      { ok: true, outputFile, summary: snapshot.summary, nextActions: snapshot.nextActions },
      null,
      2,
    ),
  );
  process.exit(0);
}

const response = await fetch(syncUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(config.syncToken ? { authorization: `Bearer ${config.syncToken}` } : {}),
  },
  body: JSON.stringify({ snapshot }),
});

if (!response.ok) {
  throw new Error(`Homework Goalie sync failed: HTTP ${response.status} ${await response.text()}`);
}

console.log(await response.text());
