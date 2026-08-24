#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
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
const chineseConventionalCommit =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)]+\))?!?: .*\p{Script=Han}/u;

function git(args, options = {}) {
  const output = execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function statusLines() {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  return status ? status.split("\n") : [];
}

function currentBranch() {
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!branch) throw new Error("当前处于 detached HEAD，拒绝提交");
  return branch;
}

function assertSafeChanges(lines) {
  for (const line of lines) {
    const code = line.slice(0, 2);
    const filePath = line
      .slice(3)
      .trim()
      .replace(/^.* -> /u, "");
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
      throw new Error(`拒绝提交敏感文件：${filePath}`);
    }
  }
}

function assertDiffClean() {
  const result = spawnSync("git", ["diff", "--cached", "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stdout || result.stderr || "差异格式检查失败").trim(),
    );
  }
}

function defaultSubject(lines) {
  const counts = { 新增: 0, 修改: 0, 删除: 0 };
  for (const line of lines) {
    const code = line.slice(0, 2);
    if (code.includes("?") || code.includes("A")) counts.新增 += 1;
    else if (code.includes("D")) counts.删除 += 1;
    else counts.修改 += 1;
  }
  const summary = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}${count}项`)
    .join("、");
  return `chore(整体修改): 完成工作区变更（${summary}）`;
}

function push(branch) {
  let remote = "origin";
  try {
    const configured = git(["config", "--get", `branch.${branch}.remote`]);
    if (configured && configured !== ".") remote = configured;
  } catch {
    // A branch without an upstream is published to origin.
  }
  git(["push", "--set-upstream", remote, `HEAD:refs/heads/${branch}`], {
    stdio: "inherit",
  });
  console.log(`[整体提交] 已推送到 ${remote}/${branch}`);
}

function hasUnpushedCommits() {
  try {
    return Number(git(["rev-list", "--count", "@{upstream}..HEAD"])) > 0;
  } catch {
    return true;
  }
}

function main() {
  const branch = currentBranch();
  const lines = statusLines();
  if (lines.length === 0) {
    if (hasUnpushedCommits()) push(branch);
    else console.log("[整体提交] 工作区与远端已同步，无需提交");
    return;
  }

  assertSafeChanges(lines);
  const suppliedMessage = process.argv
    .slice(2)
    .filter((argument) => argument !== "--")
    .join(" ")
    .trim();
  const subject = suppliedMessage || defaultSubject(lines);
  if (!chineseConventionalCommit.test(subject)) {
    throw new Error(
      "提交信息必须是包含中文主题的 Conventional Commit，例如：feat: 完成账号余额展示",
    );
  }

  git(["add", "--all", "--", "."]);
  assertDiffClean();
  git(
    [
      "commit",
      "-m",
      subject,
      "-m",
      `完成并验证后整体提交。本次变更共 ${lines.length} 个文件。`,
    ],
    { stdio: "inherit" },
  );
  console.log(`[整体提交] 已提交：${subject}`);
  push(branch);
}

try {
  main();
} catch (error) {
  console.error(
    `[整体提交] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
