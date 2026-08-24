import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  normalizeOutboundProxyConfig,
  type OutboundProxyConfig,
  type OutboundProxyMode,
} from "@covel/ai-provider";

const MODE_VALUES = new Set<OutboundProxyMode>([
  "direct",
  "system",
  "http",
  "socks",
]);

function readTomlString(
  source: string,
  section: string,
  key: string,
): string | undefined {
  let activeSection = "";
  for (const line of source.split(/\r?\n/)) {
    const sectionMatch = /^\s*\[([^\]]+)]\s*(?:#.*)?$/.exec(line);
    if (sectionMatch) {
      activeSection = sectionMatch[1]!.trim();
      continue;
    }
    if (activeSection !== section) continue;
    const valueMatch = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`).exec(line);
    if (!valueMatch) continue;
    try {
      const value = JSON.parse(valueMatch[1]!) as unknown;
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function readStoredProxyConfig(covelHome: string): OutboundProxyConfig {
  const file = join(covelHome, "config.toml");
  if (!existsSync(file)) return { mode: "direct" };
  try {
    const source = readFileSync(file, "utf-8");
    const rawMode = readTomlString(source, "network", "proxy_mode");
    const mode = MODE_VALUES.has(rawMode as OutboundProxyMode)
      ? (rawMode as OutboundProxyMode)
      : "direct";
    const url = readTomlString(source, "network", "proxy_url");
    return normalizeOutboundProxyConfig({ mode, ...(url ? { url } : {}) });
  } catch (error) {
    console.warn("[proxy-config] Could not read proxy settings:", error);
    return { mode: "direct" };
  }
}

function writeSectionValues(
  source: string,
  section: string,
  values: Record<string, string>,
): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const headerPattern = new RegExp(`^\\s*\\[${section}]\\s*(?:#.*)?$`);
  const headerIndex = lines.findIndex((line) => headerPattern.test(line));
  if (headerIndex < 0) {
    const prefix = source.trimEnd();
    const body = Object.entries(values)
      .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
      .join("\n");
    return `${prefix ? `${prefix}\n\n` : ""}[${section}]\n${body}\n`;
  }

  let sectionEnd = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index++) {
    if (/^\s*\[[^\]]+]\s*(?:#.*)?$/.test(lines[index]!)) {
      sectionEnd = index;
      break;
    }
  }
  let insertAt = headerIndex + 1;
  for (const [key, value] of Object.entries(values)) {
    const keyPattern = new RegExp(`^\\s*(?:#\\s*)?${key}\\s*=`);
    const existingIndex = lines.findIndex(
      (line, index) =>
        index > headerIndex && index < sectionEnd && keyPattern.test(line),
    );
    const replacement = `${key} = ${JSON.stringify(value)}`;
    if (existingIndex >= 0) {
      lines[existingIndex] = replacement;
      insertAt = Math.max(insertAt, existingIndex + 1);
    } else {
      lines.splice(insertAt, 0, replacement);
      insertAt += 1;
      sectionEnd += 1;
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function writeStoredProxyConfig(
  covelHome: string,
  config: OutboundProxyConfig,
): void {
  const normalized = normalizeOutboundProxyConfig(config);
  const file = join(covelHome, "config.toml");
  const source = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const next = writeSectionValues(source, "network", {
    proxy_mode: normalized.mode,
    proxy_url: normalized.url ?? "",
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next, { encoding: "utf-8", mode: 0o600 });
  chmodSync(file, 0o600);
}
