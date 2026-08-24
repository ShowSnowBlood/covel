import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { createConnectPinnedDispatcher } from "./adapters/http/dns-safety.js";

export type OutboundProxyMode = "direct" | "system" | "http" | "socks";

export interface OutboundProxyConfig {
  readonly mode: OutboundProxyMode;
  readonly url?: string;
}

export interface ConfigureOutboundProxyInput extends OutboundProxyConfig {
  /** Proxy URL resolved by the Electron main process from the OS settings. */
  readonly systemProxyUrl?: string;
}

export interface OutboundProxyStatus extends OutboundProxyConfig {
  readonly effective: "direct" | "proxy";
  readonly systemAvailable: boolean;
}

let currentConfig: OutboundProxyConfig = { mode: "direct" };
let currentSystemProxyUrl: string | undefined;
let proxyDispatcher: Dispatcher | undefined;
let directDispatcher:
  ReturnType<typeof createConnectPinnedDispatcher> | undefined;

function getDirectDispatcher(): ReturnType<
  typeof createConnectPinnedDispatcher
> {
  directDispatcher ??= createConnectPinnedDispatcher();
  return directDispatcher;
}

function customProxyUrl(mode: "http" | "socks", rawUrl: string): string {
  const value = rawUrl.trim();
  if (!value) throw new Error("Proxy address is required.");
  const withScheme = value.includes("://")
    ? value
    : `${mode === "socks" ? "socks5" : "http"}://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Proxy address must be a valid URL or host:port.");
  }
  const allowedProtocols =
    mode === "socks"
      ? new Set(["socks:", "socks5:"])
      : new Set(["http:", "https:"]);
  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error(
      mode === "socks"
        ? "SOCKS proxy address must use socks:// or socks5://."
        : "HTTP proxy address must use http:// or https://.",
    );
  }
  if (mode === "socks" && parsed.protocol === "socks:") {
    parsed.protocol = "socks5:";
  }
  if (!parsed.hostname) throw new Error("Proxy address must include a host.");
  if (
    (parsed.pathname && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Proxy address cannot include a path, query, or fragment.");
  }
  return parsed.href.replace(/\/$/, "");
}

function systemProxyUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl?.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return undefined;
  }
  if (!["http:", "https:", "socks:", "socks5:"].includes(parsed.protocol)) {
    return undefined;
  }
  return parsed.href.replace(/\/$/, "");
}

export function normalizeOutboundProxyConfig(
  input: OutboundProxyConfig,
): OutboundProxyConfig {
  switch (input.mode) {
    case "direct":
    case "system":
      return { mode: input.mode };
    case "http":
    case "socks":
      return {
        mode: input.mode,
        url: customProxyUrl(input.mode, input.url ?? ""),
      };
    default:
      throw new Error("Proxy mode must be direct, system, http, or socks.");
  }
}

/** Apply a new process-wide transport selection for framework-owned requests. */
export function configureOutboundProxy(
  input: ConfigureOutboundProxyInput,
): OutboundProxyStatus {
  const normalized = normalizeOutboundProxyConfig(input);
  const nextSystemProxyUrl = systemProxyUrl(input.systemProxyUrl);
  const effectiveProxyUrl =
    normalized.mode === "system" ? nextSystemProxyUrl : normalized.url;
  const nextDispatcher = effectiveProxyUrl
    ? new ProxyAgent(effectiveProxyUrl)
    : undefined;
  const previous = proxyDispatcher;

  currentConfig = normalized;
  currentSystemProxyUrl = nextSystemProxyUrl;
  proxyDispatcher = nextDispatcher;
  if (previous) void previous.close().catch(() => undefined);
  return getOutboundProxyStatus();
}

export function getOutboundProxyStatus(): OutboundProxyStatus {
  return {
    ...currentConfig,
    effective: proxyDispatcher ? "proxy" : "direct",
    systemAvailable: currentSystemProxyUrl !== undefined,
  };
}

function runtimeFetch(): typeof undiciFetch | typeof globalThis.fetch {
  // Existing unit tests intentionally replace global fetch. Production and
  // development always use the npm Undici implementation paired with the npm
  // dispatcher, avoiding Electron's built-in Undici version boundary.
  return process.env.NODE_ENV === "test" ? globalThis.fetch : undiciFetch;
}

function actionableFetchError(error: unknown): Error | unknown {
  let cause: unknown = error;
  let detail: Error | undefined;
  let code: string | undefined;
  for (let depth = 0; cause instanceof Error && depth < 6; depth++) {
    if (cause.message.startsWith("SSRF policy rejected")) return cause;
    if (depth > 0) detail = cause;
    const candidateCode = (cause as Error & { code?: unknown }).code;
    if (typeof candidateCode === "string" && candidateCode)
      code = candidateCode;
    cause = cause.cause;
  }
  if (!(error instanceof Error) || !detail) return error;
  const prefix = code ? `${code}: ` : "";
  return new Error(`${error.message}: ${prefix}${detail.message}`, {
    cause: error,
  });
}

/** Fetch with an explicitly compatible Undici dispatcher and useful causes. */
export async function fetchWithDispatcher(
  input: string | URL,
  init: RequestInit,
  dispatcher: Dispatcher,
): Promise<Response> {
  try {
    const fetchImpl = runtimeFetch();
    return (await fetchImpl(
      input as never,
      {
        ...init,
        dispatcher,
      } as never,
    )) as unknown as Response;
  } catch (error) {
    throw actionableFetchError(error);
  }
}

/** Framework-owned provider/model-database fetch honoring desktop proxy mode. */
export function outboundFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetchWithDispatcher(
    input,
    init,
    proxyDispatcher ?? getDirectDispatcher(),
  );
}

export async function resetOutboundProxyForTests(): Promise<void> {
  const dispatchers = [proxyDispatcher, directDispatcher].filter(
    (dispatcher): dispatcher is Dispatcher => dispatcher !== undefined,
  );
  proxyDispatcher = undefined;
  directDispatcher = undefined;
  currentConfig = { mode: "direct" };
  currentSystemProxyUrl = undefined;
  await Promise.all(dispatchers.map((dispatcher) => dispatcher.close()));
}
