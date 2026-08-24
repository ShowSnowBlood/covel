import { Buffer } from "node:buffer";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { SlotOverridesInput } from "@covel/ai-provider";
import type { DeploymentTier } from "@covel/shared";
import type { AiStack } from "../ai-setup.js";
import {
  basicAuthorization,
  FrostFoxClientConfigManager,
  providerIdForChannel,
  readFrostFoxRuntimeConfig,
  type FrostFoxRuntimeConfig,
  type ManagedFrostFoxProvider,
} from "./config.js";
import {
  createFrostFoxCredentialStore,
  deriveContextKey,
  hashOpaqueToken,
  openSecret,
  sealSecret,
  type FrostFoxBinding,
  type FrostFoxCredentialStore,
} from "./credentials.js";

const AUTH_TRANSACTION_TTL_MS = 5 * 60_000;
const AUTHORIZATION_CODE_RE = /^ffac_[A-Za-z0-9_-]+$/;
const BASE64URL_32_RE = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ROUTER_REQUEST_TIMEOUT_MS = 15_000;
const MODEL_CACHE_TTL_MS = 60_000;
const FROSTFOX_PROVIDER_PREFIX = "frostfox-";

export interface FrostFoxPrincipal {
  readonly localUserId: string;
  readonly routerAccountId: string;
  readonly accountName: string;
  readonly balance: number;
  readonly credentialState: "active" | "recovery_required";
  readonly lastVerifiedAt: string;
}

export interface FrostFoxAuthorizationStart {
  readonly redirectUrl: string;
  readonly transactionToken: string;
  readonly maxAgeSeconds: number;
}

export interface FrostFoxAuthorizationResult {
  readonly principal: FrostFoxPrincipal;
  readonly sessionToken: string;
  readonly maxAgeSeconds: number;
}

export interface FrostFoxModelEntry {
  readonly id: string;
  readonly name: string;
}

export interface FrostFoxModelChannel {
  readonly channelKey: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly protocol: "openai-chat-v1";
  readonly baseUrl: string;
  readonly models: readonly FrostFoxModelEntry[];
  readonly error?: string;
}

export interface FrostFoxModelCatalog {
  readonly configurationVersion: string;
  readonly channels: readonly FrostFoxModelChannel[];
}
export interface FrostFoxAiContext {
  readonly principal: FrostFoxPrincipal;
  readonly apiKeys: Record<string, string>;
}

interface RouterAccount {
  readonly id: string;
  readonly name: string;
  readonly balance: number;
}

interface ModelCacheEntry {
  readonly key: string;
  readonly expiresAt: number;
  readonly value: FrostFoxModelCatalog;
}

export interface FrostFoxHostEnvironment {
  readonly storeBackend: "memory" | "sqlite" | "pg";
  readonly databaseUrl: string | undefined;
  readonly sqlitePath: string;
  readonly deploymentTier: DeploymentTier;
}

export class FrostFoxServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "FrostFoxServiceError";
  }
}

export class FrostFoxService {
  private readonly sessionSigningKey: Buffer;
  private readonly modelCache = new Map<string, ModelCacheEntry>();

  private constructor(
    readonly runtimeConfig: FrostFoxRuntimeConfig,
    readonly clientConfig: FrostFoxClientConfigManager,
    private readonly store: FrostFoxCredentialStore,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.sessionSigningKey = deriveContextKey(
      runtimeConfig.credentialKey,
      `frostfox-session-signing:v1\n${runtimeConfig.clientId}`,
    );
  }

  static async create(options: {
    readonly env: FrostFoxHostEnvironment;
    readonly ai: AiStack;
    readonly source?: Record<string, string | undefined>;
    readonly fetchImpl?: typeof fetch;
    readonly credentialStore?: FrostFoxCredentialStore;
  }): Promise<FrostFoxService | null> {
    const runtimeConfig = readFrostFoxRuntimeConfig(
      options.source ?? process.env,
    );
    if (!runtimeConfig) return null;
    if (options.env.deploymentTier !== "commercial") {
      throw new Error(
        "FrostFox SaaS may only be enabled for DEPLOYMENT_TIER=commercial",
      );
    }
    if (options.env.storeBackend === "memory") {
      throw new Error(
        "FrostFox SaaS requires persistent SQLite or PostgreSQL storage",
      );
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const store =
      options.credentialStore ??
      (await createFrostFoxCredentialStore(options.env));
    const clientConfig = new FrostFoxClientConfigManager(
      runtimeConfig,
      options.ai,
      fetchImpl,
    );
    try {
      await store.purgeExpiredTransactions(Date.now());
      await clientConfig.start();
      return new FrostFoxService(runtimeConfig, clientConfig, store, fetchImpl);
    } catch (error) {
      clientConfig.stop();
      await store.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.clientConfig.stop();
    this.sessionSigningKey.fill(0);
    this.modelCache.clear();
    await this.store.close();
  }

  async startAuthorization(): Promise<FrostFoxAuthorizationStart> {
    const transactionToken = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256")
      .update(verifier, "ascii")
      .digest("base64url");
    const tokenHash = hashOpaqueToken(transactionToken);
    const now = Date.now();
    await this.store.purgeExpiredTransactions(now);
    await this.store.createLoginTransaction({
      tokenHash,
      state,
      verifierCiphertext: sealSecret(
        verifier,
        this.runtimeConfig.credentialKey,
        loginTransactionAad(tokenHash, this.runtimeConfig.clientId),
      ),
      expiresAt: now + AUTH_TRANSACTION_TTL_MS,
      createdAt: now,
    });

    const authorizeUrl = new URL(
      "/saas/authorize",
      this.runtimeConfig.routerBaseUrl,
    );
    authorizeUrl.searchParams.set("clientId", this.runtimeConfig.clientId);
    authorizeUrl.searchParams.set(
      "redirectUri",
      this.runtimeConfig.callbackUrl,
    );
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("codeChallenge", challenge);
    authorizeUrl.searchParams.set("codeChallengeMethod", "S256");

    return {
      redirectUrl: authorizeUrl.toString(),
      transactionToken,
      maxAgeSeconds: Math.floor(AUTH_TRANSACTION_TTL_MS / 1000),
    };
  }

  async completeAuthorization(input: {
    readonly code: string;
    readonly state: string;
    readonly transactionToken: string | undefined;
    readonly currentSessionToken: string | undefined;
  }): Promise<FrostFoxAuthorizationResult> {
    if (
      !AUTHORIZATION_CODE_RE.test(input.code) ||
      !BASE64URL_32_RE.test(input.state) ||
      !input.transactionToken ||
      !BASE64URL_32_RE.test(input.transactionToken)
    ) {
      throw new FrostFoxServiceError("invalid_frostfox_callback", 400);
    }

    const tokenHash = hashOpaqueToken(input.transactionToken);
    const transaction = await this.store.consumeLoginTransaction(
      tokenHash,
      input.state,
      Date.now(),
    );
    if (!transaction) {
      throw new FrostFoxServiceError("frostfox_login_transaction_invalid", 400);
    }

    const verifier = openSecret(
      transaction.verifierCiphertext,
      this.runtimeConfig.credentialKey,
      loginTransactionAad(tokenHash, this.runtimeConfig.clientId),
    );
    const accountKey = await this.exchangeAuthorizationCode(
      input.code,
      verifier,
    );
    const account = await this.readRouterAccount(accountKey);
    const current = await this.resolvePrincipal(input.currentSessionToken);
    if (current && current.routerAccountId !== account.id) {
      throw new FrostFoxServiceError("frostfox_account_conflict", 409);
    }

    const existing = await this.store.getBindingBySubject(
      this.runtimeConfig.routerBaseUrl,
      account.id,
    );
    const now = new Date().toISOString();
    const localUserId =
      existing?.localUserId ?? current?.localUserId ?? randomUUID();
    const createdAt = existing?.createdAt ?? now;
    const accountKeyCiphertext = sealSecret(
      accountKey,
      this.runtimeConfig.credentialKey,
      accountBindingAad(
        this.runtimeConfig.routerBaseUrl,
        account.id,
        this.runtimeConfig.clientId,
      ),
    );
    const binding = await this.store.upsertBinding({
      localUserId,
      issuer: this.runtimeConfig.routerBaseUrl,
      routerAccountId: account.id,
      accountName: account.name,
      balance: account.balance,
      accountKeyCiphertext,
      credentialState: "active",
      credentialGenerationUpdatedAt: now,
      lastVerifiedAt: now,
      createdAt,
      updatedAt: now,
    });
    this.modelCache.delete(binding.localUserId);

    return {
      principal: principalFromBinding(binding),
      sessionToken: this.issueSessionToken(binding.localUserId),
      maxAgeSeconds: SESSION_TTL_SECONDS,
    };
  }

  async resolvePrincipal(
    sessionToken: string | undefined,
  ): Promise<FrostFoxPrincipal | null> {
    const localUserId = this.verifySessionToken(sessionToken);
    if (!localUserId) return null;
    const binding = await this.store.getBindingByLocalUserId(localUserId);
    return binding ? principalFromBinding(binding) : null;
  }

  async unbind(principal: FrostFoxPrincipal): Promise<void> {
    await this.store.deleteBinding(principal.localUserId);
    this.modelCache.delete(principal.localUserId);
  }

  async handleGatewayUnauthorized(principal: FrostFoxPrincipal): Promise<void> {
    try {
      await this.clientConfig.refresh();
    } catch {
      // Client configuration failure is operational, not evidence that the
      // account credential is invalid. Retain the binding unchanged.
      return;
    }
    await this.refreshPrincipal(principal);
  }

  async refreshPrincipal(
    principal: FrostFoxPrincipal,
  ): Promise<FrostFoxPrincipal> {
    const binding = await this.requiredBinding(principal.localUserId);
    const accountKey = this.openAccountKey(binding);
    const response = await this.fetchImpl(
      `${this.runtimeConfig.routerBaseUrl}/api/account/v1/me`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${accountKey}`,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(ROUTER_REQUEST_TIMEOUT_MS),
      },
    );
    const now = new Date().toISOString();
    if (response.status === 401) {
      const updated = await this.store.upsertBinding({
        ...binding,
        credentialState: "recovery_required",
        updatedAt: now,
      });
      this.modelCache.delete(binding.localUserId);
      return principalFromBinding(updated);
    }
    if (!response.ok) return principalFromBinding(binding);

    const body: unknown = await response.json();
    if (
      !isRecord(body) ||
      body.id !== binding.routerAccountId ||
      typeof body.name !== "string" ||
      typeof body.balance !== "number" ||
      !Number.isFinite(body.balance)
    ) {
      return principalFromBinding(binding);
    }
    const updated = await this.store.upsertBinding({
      ...binding,
      accountName: body.name,
      balance: body.balance,
      credentialState: "active",
      lastVerifiedAt: now,
      updatedAt: now,
    });
    return principalFromBinding(updated);
  }

  async prepareAiContext(
    principal: FrostFoxPrincipal | null,
  ): Promise<FrostFoxAiContext | null> {
    if (!principal) return null;
    if (principal.credentialState !== "active") {
      throw new FrostFoxServiceError("frostfox_reconnect_required", 401);
    }
    const binding = await this.requiredBinding(principal.localUserId);
    const accountKey = this.openAccountKey(binding);
    const gatewayKey = deriveFrostFoxGatewayKey(
      accountKey,
      this.runtimeConfig.clientId,
    );
    this.clientConfig.ensureProvidersInstalled();
    const apiKeys = Object.fromEntries(
      this.clientConfig
        .providers()
        .map((provider) => [provider.providerId, gatewayKey]),
    );
    return { principal, apiKeys };
  }

  sanitizeSlotOverrides(
    overrides: SlotOverridesInput | null,
    authenticated: boolean,
  ): SlotOverridesInput | null {
    if (!overrides?.customPresets?.length) return overrides;
    const rejectedIds = new Set<string>();
    const customPresets = overrides.customPresets.flatMap((preset) => {
      if (!preset.provider.startsWith(FROSTFOX_PROVIDER_PREFIX))
        return [preset];
      const provider = this.clientConfig.providerById(preset.provider);
      if (
        !authenticated ||
        !provider ||
        !preset.model ||
        preset.model.length > 200
      ) {
        rejectedIds.add(preset.id);
        return [];
      }
      return [
        {
          ...preset,
          provider: provider.providerId,
          baseUrl: provider.baseUrl,
          protocol: provider.protocol,
        },
      ];
    });
    if (rejectedIds.size > 0) {
      throw new FrostFoxServiceError("frostfox_model_binding_invalid", 400);
    }
    const slotPresetOverrides = Object.fromEntries(
      Object.entries(overrides.slotPresetOverrides ?? {}),
    );
    return {
      ...overrides,
      customPresets,
      ...(Object.keys(slotPresetOverrides).length > 0
        ? { slotPresetOverrides }
        : { slotPresetOverrides: undefined }),
    };
  }

  async listModels(
    principal: FrostFoxPrincipal,
  ): Promise<FrostFoxModelCatalog> {
    const binding = await this.requiredBinding(principal.localUserId);
    if (binding.credentialState !== "active") {
      throw new FrostFoxServiceError("frostfox_reconnect_required", 401);
    }
    const cacheKey = `${this.clientConfig.snapshot.configurationVersion}\n${binding.credentialGenerationUpdatedAt}`;
    const cached = this.modelCache.get(binding.localUserId);
    if (cached && cached.key === cacheKey && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const accountKey = this.openAccountKey(binding);
    const gatewayKey = deriveFrostFoxGatewayKey(
      accountKey,
      this.runtimeConfig.clientId,
    );
    const providers = new Map(
      this.clientConfig
        .providers()
        .map((provider) => [provider.channelKey, provider] as const),
    );
    const channels = await Promise.all(
      this.clientConfig.snapshot.channelMappings.map(async (mapping) => {
        const provider = providers.get(mapping.channelKey);
        if (!mapping.enabled || !provider) {
          return {
            channelKey: mapping.channelKey,
            providerId: providerIdForChannel(mapping.channelKey),
            displayName: mapping.routerChannelDisplayName,
            enabled: false,
            protocol: "openai-chat-v1" as const,
            baseUrl: `${this.runtimeConfig.routerBaseUrl}/v1`,
            models: [],
            error: "channel_unavailable",
          };
        }
        return this.fetchChannelModels(provider, gatewayKey);
      }),
    );
    const value = {
      configurationVersion: this.clientConfig.snapshot.configurationVersion,
      channels,
    } satisfies FrostFoxModelCatalog;
    this.modelCache.set(binding.localUserId, {
      key: cacheKey,
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
      value,
    });
    return value;
  }

  private async fetchChannelModels(
    provider: ManagedFrostFoxProvider,
    gatewayKey: string,
  ): Promise<FrostFoxModelChannel> {
    const response = await this.fetchImpl(`${provider.baseUrl}/models`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        [this.clientConfig.snapshot.channelSelectorHeader]: provider.channelId,
        accept: "application/json",
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(ROUTER_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const error = await readGatewayErrorCode(response);
      return {
        channelKey: provider.channelKey,
        providerId: provider.providerId,
        displayName: provider.displayName,
        enabled: true,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        models: [],
        error,
      };
    }
    const body: unknown = await response.json();
    const models = parseModelList(body);
    return {
      channelKey: provider.channelKey,
      providerId: provider.providerId,
      displayName: provider.displayName,
      enabled: true,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      models,
    };
  }

  private async exchangeAuthorizationCode(
    code: string,
    verifier: string,
  ): Promise<string> {
    const response = await this.fetchImpl(
      `${this.runtimeConfig.routerBaseUrl}/api/account/v1/saas/exchange`,
      {
        method: "POST",
        headers: {
          authorization: basicAuthorization(this.runtimeConfig),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          code,
          redirectUri: this.runtimeConfig.callbackUrl,
          codeVerifier: verifier,
        }),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(ROUTER_REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new FrostFoxServiceError("frostfox_exchange_failed", 401);
    }
    const body: unknown = await response.json();
    if (
      !isRecord(body) ||
      typeof body.accountKey !== "string" ||
      !body.accountKey.startsWith("ffak_")
    ) {
      throw new FrostFoxServiceError("frostfox_exchange_invalid", 502);
    }
    return body.accountKey;
  }

  private async readRouterAccount(accountKey: string): Promise<RouterAccount> {
    const response = await this.fetchImpl(
      `${this.runtimeConfig.routerBaseUrl}/api/account/v1/me`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${accountKey}`,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(ROUTER_REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new FrostFoxServiceError("frostfox_account_unavailable", 401);
    }
    const body: unknown = await response.json();
    if (
      !isRecord(body) ||
      typeof body.id !== "string" ||
      body.id.length === 0 ||
      typeof body.name !== "string" ||
      body.name.length === 0 ||
      typeof body.balance !== "number" ||
      !Number.isFinite(body.balance)
    ) {
      throw new FrostFoxServiceError("frostfox_account_response_invalid", 502);
    }
    return { id: body.id, name: body.name, balance: body.balance };
  }

  private async requiredBinding(localUserId: string): Promise<FrostFoxBinding> {
    const binding = await this.store.getBindingByLocalUserId(localUserId);
    if (!binding) {
      throw new FrostFoxServiceError("frostfox_session_invalid", 401);
    }
    return binding;
  }

  private openAccountKey(binding: FrostFoxBinding): string {
    return openSecret(
      binding.accountKeyCiphertext,
      this.runtimeConfig.credentialKey,
      accountBindingAad(
        binding.issuer,
        binding.routerAccountId,
        this.runtimeConfig.clientId,
      ),
    );
  }

  private issueSessionToken(localUserId: string): string {
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const payload = `v1.${localUserId}.${expiresAt.toString(36)}.${randomBytes(16).toString("base64url")}`;
    const signature = createHmac("sha256", this.sessionSigningKey)
      .update(payload, "utf8")
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  private verifySessionToken(token: string | undefined): string | null {
    if (!token || token.length > 512) return null;
    const parts = token.split(".");
    if (parts.length !== 5 || parts[0] !== "v1") return null;
    const [version, localUserId, expiresEncoded, nonce, signature] = parts;
    if (!version || !localUserId || !expiresEncoded || !nonce || !signature) {
      return null;
    }
    const expiresAt = Number.parseInt(expiresEncoded, 36);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() / 1000) {
      return null;
    }
    const payload = `${version}.${localUserId}.${expiresEncoded}.${nonce}`;
    const expected = createHmac("sha256", this.sessionSigningKey)
      .update(payload, "utf8")
      .digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, "base64url");
    } catch {
      return null;
    }
    return provided.length === expected.length &&
      timingSafeEqual(provided, expected)
      ? localUserId
      : null;
  }
}

export function deriveFrostFoxGatewayKey(
  accountKey: string,
  clientId: string,
): string {
  const context = `frostfox-gateway:v2\n${clientId}`;
  const digest = createHmac("sha256", Buffer.from(accountKey, "utf8"))
    .update(context, "ascii")
    .digest("base64url");
  return `sk-ff-${digest}`;
}

function principalFromBinding(binding: FrostFoxBinding): FrostFoxPrincipal {
  return {
    localUserId: binding.localUserId,
    routerAccountId: binding.routerAccountId,
    accountName: binding.accountName,
    balance: binding.balance,
    credentialState: binding.credentialState,
    lastVerifiedAt: binding.lastVerifiedAt,
  };
}

function loginTransactionAad(tokenHash: string, clientId: string): string {
  return `login\n${clientId}\n${tokenHash}`;
}

function accountBindingAad(
  issuer: string,
  routerAccountId: string,
  clientId: string,
): string {
  return `binding\n${issuer}\n${routerAccountId}\n${clientId}`;
}

function parseModelList(value: unknown): FrostFoxModelEntry[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new FrostFoxServiceError("frostfox_models_response_invalid", 502);
  }
  const seen = new Set<string>();
  const models: FrostFoxModelEntry[] = [];
  for (const item of value.data) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    models.push({
      id: item.id,
      name:
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : item.id,
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

async function readGatewayErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) {
      const code = body.error.code;
      if (typeof code === "string" && code) return code;
    }
  } catch {
    // The stable fallback below preserves the HTTP status without response text.
  }
  return `gateway_http_${response.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
