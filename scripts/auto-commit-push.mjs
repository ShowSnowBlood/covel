#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const once = process.argv.includes("--once");
const quietPeriodMs = 2_000;
const retryPeriodMs = 10_000;
const ignoredPathParts = new Set([
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "release",
  "test-results",
]);

let timer = null;
let retryTimer = null;
let running = false;
let pending = false;
let watcher = null;

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function log(message) {
  console.log(`[自动提交] ${message}`);
}

function warn(message) {
  console.error(`[自动提交] ${message}`);
}

function isIgnoredPath(filePath) {
  if (!filePath) return false;
  return filePath.split(/[\\/]/u).some((part) => ignoredPathParts.has(part));
}

function changedFiles() {
  const status = git([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (!status) return [];

  return status
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .filter((filePath) => !isIgnoredPath(filePath));
}

function currentBranch() {
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!branch) throw new Error("当前处于 detached HEAD，已跳过自动提交");
  return branch;
}

function commitSubject(files) {
  const counts = { 新增: 0, 修改: 0, 删除: 0 };
  const status = git([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);

  for (const line of status.split("\n")) {
    const code = line.slice(0, 2);
    if (!code.trim()) continue;
    if (code.includes("?") || code.includes("A")) counts.新增 += 1;
    else if (code.includes("D")) counts.删除 += 1;
    else counts.修改 += 1;
  }

  const summary = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}${count}项`)
    .join("、");
  const scope = files.length === 1 ? path.basename(files[0]) : "工作区";
  return `chore(自动提交): 自动同步${scope}（${summary}）`;
}

function push(branch) {
  try {
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
    git(["push", "origin", `HEAD:${branch}`], { stdio: "inherit" });
  } catch (error) {
    git(["push", "--set-upstream", "origin", branch], { stdio: "inherit" });
  }
  log(`已推送到 origin/${branch}`);
}

function runCycle() {
  if (running) {
    pending = true;
    return;
  }

  running = true;
  pending = false;
  try {
    const files = changedFiles();
    if (files.length === 0) return;

    const branch = currentBranch();
    git(["add", "--all", "--", "."]);
    if (!git(["diff", "--cached", "--name-only"])) {
      return;
    }

    const subject = commitSubject(files);
    git([
      "commit",
      "-m",
      subject,
      "-m",
      `由自动监测任务生成。本次变更共 ${files.length} 个文件。`,
    ], { stdio: "inherit" });
    log(`已提交：${subject}`);
    push(branch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`${message}；保留本地提交，稍后重试推送`);
    if (retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        runCycle();
      }, retryPeriodMs);
    }
  } finally {
    running = false;
    if (pending) schedule();
  }
}

function schedule() {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runCycle();
  }, quietPeriodMs);
}

function stop() {
  if (timer !== null) clearTimeout(timer);
  if (retryTimer !== null) clearTimeout(retryTimer);
  watcher?.close();
  process.exit(0);
}

if (once) {
  runCycle();
  process.exit(0);
}

try {
  watcher = fs.watch(repoRoot, { recursive: true }, (_eventType, filename) => {
    if (!isIgnoredPath(filename?.toString())) schedule();
  });
} catch (error) {
  throw new Error(
    `当前系统不支持递归文件监测，请使用 Windows 或安装文件监测依赖：${String(error)}`,
  );
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
log("已启动，修改停止 2 秒后自动提交并推送；按 Ctrl+C 停止");
schedule();
