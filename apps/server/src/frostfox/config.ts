import { Buffer } from "node:buffer";
import type { AiStack } from "../ai-setup.js";

const CLIENT_ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const CHANNEL_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIG_POLL_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface FrostFoxRuntimeConfig {
  readonly routerBaseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
  readonly credentialKey: Uint8Array;
}

export interface FrostFoxChannelMapping {
  readonly channelKey: string;
  readonly routerChannelId: string;
  readonly routerChannelName: string;
  readonly routerChannelDisplayName: string;
  readonly enabled: boolean;
}

export interface FrostFoxClientConfigSnapshot {
  readonly protocolVersion: "2.0";
  readonly clientId: string;
  readonly displayName: string;
  readonly callbackUrl: string;
  readonly channelSelectorHeader: "X-FrostFox-Channel-Id";
  readonly configurationVersion: string;
  readonly channelMappings: readonly FrostFoxChannelMapping[];
}

export interface ManagedFrostFoxProvider {
  readonly channelKey: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly protocol: "openai-chat-v1";
  readonly channelId: string;
}

export function readFrostFoxRuntimeConfig(
  source: Record<string, string | undefined> = process.env,
): FrostFoxRuntimeConfig | null {
  if (source.COVEL_FROSTFOX_SAAS_ENABLED !== "1") return null;

  const routerBaseUrl = canonicalHttpsOrigin(
    required(source, "COVEL_FROSTFOX_ROUTER_BASE_URL"),
    "COVEL_FROSTFOX_ROUTER_BASE_URL",
  );
  const clientId = required(source, "COVEL_FROSTFOX_CLIENT_ID");
  if (!CLIENT_ID_RE.test(clientId)) {
    throw new Error(
      "COVEL_FROSTFOX_CLIENT_ID must match ^[a-z0-9][a-z0-9_-]{2,63}$",
    );
  }
  const clientSecret = required(source, "COVEL_FROSTFOX_CLIENT_SECRET");
  if (clientSecret.includes(":")) {
    throw new Error("COVEL_FROSTFOX_CLIENT_SECRET must not contain ':'");
  }
  const callbackUrl = exactHttpsUrl(
    required(source, "COVEL_FROSTFOX_CALLBACK_URL"),
    "COVEL_FROSTFOX_CALLBACK_URL",
  );
  const credentialKey = decodeCredentialKey(
    required(source, "COVEL_FROSTFOX_CREDENTIAL_KEY"),
  );

  return {
    routerBaseUrl,
    clientId,
    clientSecret,
    callbackUrl,
    credentialKey,
  };
}

export function providerIdForChannel(channelKey: string): string {
  return `frostfox-${Buffer.from(channelKey, "utf8").toString("hex")}`;
}

export class FrostFoxClientConfigManager {
  private snapshotValue: FrostFoxClientConfigSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private failureCount = 0;
  private managedProviderIds = new Set<string>();
  private managedProviders: readonly ManagedFrostFoxProvider[] = [];
  private refreshPromise: Promise<FrostFoxClientConfigSnapshot> | null = null;

  constructor(
    private readonly config: FrostFoxRuntimeConfig,
    private readonly ai: AiStack,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    this.scheduleNext(CONFIG_POLL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  get snapshot(): FrostFoxClientConfigSnapshot {
    if (!this.snapshotValue) {
      throw new Error("FrostFox client configuration is unavailable");
    }
    return this.snapshotValue;
  }

  providers(): readonly ManagedFrostFoxProvider[] {
    return this.managedProviders;
  }

  providerById(providerId: string): ManagedFrostFoxProvider | undefined {
    return this.providers().find(
      (provider) => provider.providerId === providerId,
    );
  }

  ensureProvidersInstalled(): void {
    for (const provider of this.providers()) {
      // The frostfox-* namespace is server-managed. Remove any llm.toml or
      // request-reload collision before installing the authoritative Router
      // origin and channel header; an existing registration must never win.
      this.ai.providerRegistry.removeProvider(provider.providerId);
      this.ai.providerRegistry.addProvider(provider.providerId, {
        baseUrl: provider.baseUrl,
        protocol: provider.protocol,
        headers: {
          [this.snapshot.channelSelectorHeader]: provider.channelId,
        },
      });
    }
  }

  refresh(): Promise<FrostFoxClientConfigSnapshot> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchSnapshot()
      .then((next) => {
        const changed =
          this.snapshotValue?.configurationVersion !==
          next.configurationVersion;
        if (changed) {
          this.replaceSnapshot(next);
        } else {
          this.snapshotValue = next;
          this.ensureProvidersInstalled();
        }
        this.failureCount = 0;
        return this.snapshot;
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  private replaceSnapshot(next: FrostFoxClientConfigSnapshot): void {
    for (const providerId of this.managedProviderIds) {
      this.ai.providerRegistry.removeProvider(providerId);
    }
    this.snapshotValue = next;
    this.managedProviders = next.channelMappings
      .filter((mapping) => mapping.enabled)
      .map((mapping) => ({
        channelKey: mapping.channelKey,
        providerId: providerIdForChannel(mapping.channelKey),
        displayName: mapping.routerChannelDisplayName,
        baseUrl: `${this.config.routerBaseUrl}/v1`,
        protocol: "openai-chat-v1" as const,
        channelId: mapping.routerChannelId,
      }));
    this.managedProviderIds = new Set(
      this.managedProviders.map((provider) => provider.providerId),
    );
    this.ensureProvidersInstalled();
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    const jitter = Math.floor(Math.random() * 10_001);
    this.timer = setTimeout(() => {
      void this.refresh()
        .catch((error: unknown) => {
          this.failureCount += 1;
          console.error(
            "[frostfox] client-config refresh failed; retaining the last valid snapshot:",
            error instanceof Error ? error.message : String(error),
          );
        })
        .finally(() => {
          const backoff = Math.min(
            CONFIG_POLL_MS * 2 ** this.failureCount,
            MAX_BACKOFF_MS,
          );
          this.scheduleNext(backoff);
        });
    }, delayMs + jitter);
    this.timer.unref?.();
  }

  private async fetchSnapshot(): Promise<FrostFoxClientConfigSnapshot> {
    const response = await this.fetchImpl(
      `${this.config.routerBaseUrl}/api/account/v1/saas/client-config`,
      {
        method: "GET",
        headers: {
          authorization: basicAuthorization(this.config),
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`client-config returned HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    return validateSnapshot(payload, this.config);
  }
}

export function basicAuthorization(config: FrostFoxRuntimeConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")}`;
}

function validateSnapshot(
  value: unknown,
  expected: FrostFoxRuntimeConfig,
): FrostFoxClientConfigSnapshot {
  if (!isRecord(value)) throw new Error("client-config response must be JSON");
  if (value.protocolVersion !== "2.0") {
    throw new Error("unsupported FrostFox protocol version");
  }
  if (value.clientId !== expected.clientId) {
    throw new Error("client-config clientId mismatch");
  }
  if (value.callbackUrl !== expected.callbackUrl) {
    throw new Error("client-config callbackUrl mismatch");
  }
  if (value.channelSelectorHeader !== "X-FrostFox-Channel-Id") {
    throw new Error("client-config channel selector header mismatch");
  }
  if (
    typeof value.displayName !== "string" ||
    value.displayName.trim().length === 0 ||
    typeof value.configurationVersion !== "string" ||
    value.configurationVersion.length === 0 ||
    !Array.isArray(value.channelMappings)
  ) {
    throw new Error("client-config response is missing required fields");
  }

  const channelMappings = value.channelMappings.map((item) => {
    if (!isRecord(item)) throw new Error("invalid channel mapping");
    const channelKey = item.channelKey;
    const routerChannelId = item.routerChannelId;
    const routerChannelName = item.routerChannelName;
    const routerChannelDisplayName = item.routerChannelDisplayName;
    if (
      typeof channelKey !== "string" ||
      !CHANNEL_KEY_RE.test(channelKey) ||
      typeof routerChannelId !== "string" ||
      !UUID_RE.test(routerChannelId) ||
      typeof routerChannelName !== "string" ||
      routerChannelName.length === 0 ||
      typeof routerChannelDisplayName !== "string" ||
      routerChannelDisplayName.length === 0 ||
      typeof item.enabled !== "boolean"
    ) {
      throw new Error("invalid channel mapping fields");
    }
    return {
      channelKey,
      routerChannelId,
      routerChannelName,
      routerChannelDisplayName,
      enabled: item.enabled,
    };
  });

  return {
    protocolVersion: "2.0",
    clientId: expected.clientId,
    displayName: value.displayName,
    callbackUrl: expected.callbackUrl,
    channelSelectorHeader: "X-FrostFox-Channel-Id",
    configurationVersion: value.configurationVersion,
    channelMappings,
  };
}

function required(
  source: Record<string, string | undefined>,
  name: string,
): string {
  const value = source[name]?.trim();
  if (!value)
    throw new Error(`${name} is required when FrostFox SaaS is enabled`);
  return value;
}

function canonicalHttpsOrigin(raw: string, name: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be a canonical HTTPS origin`);
  }
  return url.origin;
}

function exactHttpsUrl(raw: string, name: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${name} must be an exact HTTPS URL without query or fragment`,
    );
  }
  return url.toString();
}

function decodeCredentialKey(raw: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) {
    throw new Error(
      "COVEL_FROSTFOX_CREDENTIAL_KEY must be 32 random bytes encoded as unpadded Base64Url",
    );
  }
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length !== 32) {
    throw new Error("COVEL_FROSTFOX_CREDENTIAL_KEY must decode to 32 bytes");
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
