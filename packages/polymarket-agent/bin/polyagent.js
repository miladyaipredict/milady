#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageDir = path.resolve(__dirname, "..");
const entrypoint = path.join(packageDir, "polymarket-demo.ts");

const tsxCandidates = [
  path.join(
    packageDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  ),
  path.join(
    packageDir,
    "..",
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  ),
];

const tsxBin = tsxCandidates.find((candidate) => existsSync(candidate));

if (!tsxBin) {
  console.error(
    "tsx binary not found. Run `bun install` from the repo root first.",
  );
  process.exit(1);
}

const child = spawn(tsxBin, [entrypoint, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
