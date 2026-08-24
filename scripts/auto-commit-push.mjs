#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
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
const allowedEnvFiles = new Set([".env.example", ".env.llm.example"]);
const sensitiveBasenames = new Set([
  ".env",
  "app.env",
  "credentials.json",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
]);
const sensitiveExtensions = new Set([".key", ".p12", ".pem", ".pfx"]);
const conflictCodes = new Set(["AA", "AU", "DD", "DU", "UA", "UD", "UU"]);

let timer = null;
let retryTimer = null;
let running = false;
let pending = false;
let watcher = null;

function git(args, options = {}) {
  const output = execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });

  return typeof output === "string" ? output.trim() : "";
}
function acquireProcessLock() {
  const gitDir = path.resolve(repoRoot, git(["rev-parse", "--git-dir"]));
  const lockPath = path.join(gitDir, "covel-auto-commit.lock");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
      return lockPath;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const ownerPid = Number(fs.readFileSync(lockPath, "utf8").trim());
      try {
        process.kill(ownerPid, 0);
        log(`已有监测任务运行（PID ${ownerPid}）`);
        process.exit(0);
      } catch {
        fs.rmSync(lockPath, { force: true });
      }
    }
  }

  throw new Error("无法获取自动提交进程锁");
}

function releaseProcessLock(lockPath) {
  try {
    if (Number(fs.readFileSync(lockPath, "utf8").trim()) === process.pid) {
      fs.rmSync(lockPath, { force: true });
    }
  } catch {
    // The lock was already removed.
  }
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
function assertSafeChanges() {
  const status = git([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);

  for (const line of status.split("\n")) {
    if (!line) continue;
    const code = line.slice(0, 2);
    const filePath = line.slice(3).trim().replace(/^.* -> /u, "");
    const basename = path.basename(filePath).toLowerCase();
    const extension = path.extname(basename);

    if (conflictCodes.has(code)) {
      throw new Error(`检测到未解决冲突：${filePath}`);
    }
    if (
      sensitiveBasenames.has(basename) ||
      (basename.startsWith(".env.") && !allowedEnvFiles.has(basename)) ||
      sensitiveExtensions.has(extension)
    ) {
      throw new Error(`拒绝自动提交敏感文件：${filePath}`);
    }
  }
}

function assertDiffClean() {
  const result = spawnSync("git", ["diff", "--cached", "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stdout || result.stderr || "差异格式检查失败").trim());
  }
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
  let remote = "origin";
  try {
    const configuredRemote = git([
      "config",
      "--get",
      `branch.${branch}.remote`,
    ]);
    if (configuredRemote && configuredRemote !== ".") remote = configuredRemote;
  } catch {
    // A branch without an upstream is published to origin below.
  }
  git(["push", "--set-upstream", remote, `HEAD:refs/heads/${branch}`], {
    stdio: "inherit",
  });
  log(`已推送到 ${remote}/${branch}`);
}
function hasUnpushedCommits() {
  try {
    return Number(git(["rev-list", "--count", "@{upstream}..HEAD"])) > 0;
  } catch {
    return true;
  }
}


function runCycle() {
  if (running) {
    pending = true;
    return true;
  }

  running = true;
  pending = false;
  try {
    const files = changedFiles();
    const branch = currentBranch();
    if (files.length === 0) {
      if (hasUnpushedCommits()) push(branch);
      return true;
    }

    assertSafeChanges();
    git(["add", "--all", "--", "."]);
    if (!git(["diff", "--cached", "--name-only"])) {
      return true;
    }
    assertDiffClean();

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
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`${message}；本地状态保持不变，稍后重试`);
    if (!once && retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        runCycle();
      }, retryPeriodMs);
    }
    return false;
  } finally {
    running = false;
    if (!once && pending) schedule();
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
  releaseProcessLock(processLockPath);
  process.exit(0);
}

const processLockPath = acquireProcessLock();
process.on("exit", () => releaseProcessLock(processLockPath));

if (once) {
  process.exit(runCycle() ? 0 : 1);
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
