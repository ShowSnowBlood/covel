import { Buffer } from "node:buffer";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  resolveCapabilityDetails,
  type InputModality,
  type ManagedModelPolicy,
  type ManualCapabilityOverride,
  type ModelCapability,
  type OutputModality,
  type SlotOverridesInput,
} from "@covel/ai-provider";
import {
  FROSTFOX_LEVEL_COUNT,
  frostFoxLevelForWorld,
  type DeploymentTier,
} from "@covel/shared";

import type { AiStack } from "../ai-setup.js";
import { isRecord } from "../lib/validators.js";
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
  type FrostFoxModelSchedule,
  type FrostFoxModelScheduleEntry,
} from "./credentials.js";

const AUTH_TRANSACTION_TTL_MS = 5 * 60_000;
const AUTHORIZATION_CODE_RE = /^ffac_[A-Za-z0-9_-]+$/;
const BASE64URL_32_RE = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ROUTER_REQUEST_TIMEOUT_MS = 15_000;
const FROSTFOX_PROVIDER_PREFIX = "frostfox-";

export interface FrostFoxPrincipal {
  readonly localUserId: string;
  readonly routerAccountId: string;
  readonly accountName: string;
  readonly balance: number;
  /** Router-admin role; optional for compatibility with pre-role fixtures. */
  readonly isAdmin?: boolean;
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

interface FrostFoxModelEntry {
  readonly id: string;
  readonly name: string;
  readonly capability: ModelCapability;
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
interface FrostFoxProgressionStatus {
  readonly completedLevel: number;
  readonly unlockedLevel: number;
  readonly totalLevels: number;
  readonly updatedAt: string | null;
}

export interface FrostFoxAiContext {
  readonly principal: FrostFoxPrincipal;
  readonly apiKeys: Record<string, string>;
  readonly managedSlotDefaults: SlotOverridesInput | undefined;
  /** Forced preset selection applied by the gateway for non-admin accounts. */
  readonly managedModelPolicy?: ManagedModelPolicy;
}

interface RouterAccountPayload {
  readonly id: string;
  readonly name: string;
  readonly balance: number;
  readonly isAdmin?: boolean;
}

interface RouterAccount extends RouterAccountPayload {
  readonly isAdmin: boolean;
}
/**
 * The catalog is keyed by config version and credential generation rather
 * than wall-clock expiry, so one login does not repeatedly probe every channel.
 */
interface ModelCacheEntry {
  readonly key: string;
  readonly value: FrostFoxModelCatalog;
}
interface ModelRequestEntry {
  readonly key: string;
  readonly promise: Promise<FrostFoxModelCatalog>;
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
  private readonly modelRequests = new Map<string, ModelRequestEntry>();

  private constructor(
    readonly runtimeConfig: FrostFoxRuntimeConfig,
    readonly clientConfig: FrostFoxClientConfigManager,
    private readonly store: FrostFoxCredentialStore,
    private readonly fetchImpl: typeof fetch,
    private readonly managedSlotDefaults: SlotOverridesInput | undefined,
    private readonly preferredImageModel: string | undefined,
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
      return new FrostFoxService(
        runtimeConfig,
        clientConfig,
        store,
        fetchImpl,
        buildManagedSlotDefaults(options.ai, clientConfig),
        options.ai.config.presets.find(
          (preset) => preset.enabled && preset.defaultSlot === "image",
        )?.model,
      );
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
    this.modelRequests.clear();
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
    const existing = await this.store.getBindingBySubject(
      this.runtimeConfig.routerBaseUrl,
      account.id,
    );
    const now = new Date().toISOString();
    // A new authorization may intentionally select a different Router account.
    // Keep each account's durable local identity separate: reusing the current
    // session's localUserId would overwrite the old binding (or violate the
    // SQLite primary key) and leak its progression/session ownership.
    const localUserId = existing?.localUserId ?? randomUUID();
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
      isAdmin: account.isAdmin === true,
      accountKeyCiphertext,
      credentialState: "active",
      credentialGenerationUpdatedAt: now,
      lastVerifiedAt: now,
      createdAt,
      updatedAt: now,
    });
    this.invalidateModelCache(binding.localUserId);

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

  /**
   * Resolve the durable account binding used by a server-side session.
   * Internal background work (embedding and memory ingestion) has a session
   * id, not the browser cookie, so it cannot use resolvePrincipal directly.
   */
  async resolvePrincipalForLocalUser(
    localUserId: string,
  ): Promise<FrostFoxPrincipal | null> {
    if (!localUserId) return null;
    const binding = await this.store.getBindingByLocalUserId(localUserId);
    return binding ? principalFromBinding(binding) : null;
  }

  async unbind(principal: FrostFoxPrincipal): Promise<void> {
    await this.store.deleteBinding(principal.localUserId);
    this.invalidateModelCache(principal.localUserId);
  }
  async getProgression(
    principal: FrostFoxPrincipal,
  ): Promise<FrostFoxProgressionStatus> {
    await this.requiredBinding(principal.localUserId);
    const progression = await this.store.getProgression(principal.localUserId);
    return progressionStatus(progression.completedLevel, progression.updatedAt);
  }

  async completeLevel(
    principal: FrostFoxPrincipal,
    worldId: string,
  ): Promise<FrostFoxProgressionStatus> {
    await this.requiredBinding(principal.localUserId);
    const level = frostFoxLevelForWorld(worldId);
    if (level === null) {
      throw new FrostFoxServiceError("frostfox_unknown_level", 400);
    }
    const current = await this.store.getProgression(principal.localUserId);
    if (level > current.completedLevel + 1) {
      throw new FrostFoxServiceError("frostfox_level_locked", 409);
    }
    const progression = await this.store.setCompletedLevel(
      principal.localUserId,
      level,
    );
    return progressionStatus(progression.completedLevel, progression.updatedAt);
  }

  async getModelSchedule(
    principal: FrostFoxPrincipal,
  ): Promise<FrostFoxModelSchedule | null> {
    const binding = await this.requiredBinding(principal.localUserId);
    if (binding.credentialState !== "active") {
      throw new FrostFoxServiceError("frostfox_reconnect_required", 401);
    }
    return this.store.getModelSchedule();
  }

  async setModelSchedule(
    principal: FrostFoxPrincipal,
    story: readonly FrostFoxModelScheduleEntry[],
  ): Promise<FrostFoxModelSchedule> {
    const binding = await this.requiredBinding(principal.localUserId);
    if (!binding.isAdmin) {
      throw new FrostFoxServiceError("frostfox_admin_required", 403);
    }
    if (binding.credentialState !== "active") {
      throw new FrostFoxServiceError("frostfox_reconnect_required", 401);
    }

    const normalized = normalizeScheduleEntries(story);
    if (normalized.length > 0) {
      const catalog = await this.listModels(principal);
      const available = new Set(
        catalog.channels
          .filter((channel) => channel.enabled && !channel.error)
          .flatMap((channel) =>
            channel.models
              .filter((model) => model.capability.output.includes("text"))
              .map((model) => `${channel.channelKey}\n${model.id}`),
          ),
      );
      if (
        normalized.some(
          (entry) => !available.has(`${entry.channelKey}\n${entry.modelId}`),
        )
      ) {
        throw new FrostFoxServiceError(
          "frostfox_model_schedule_model_invalid",
          400,
        );
      }
    }
    return this.store.setModelSchedule(normalized);
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
    const response = await this.fetchRouterAccount(accountKey);
    const now = new Date().toISOString();
    if (response.status === 401) {
      const updated = await this.store.upsertBinding({
        ...binding,
        credentialState: "recovery_required",
        updatedAt: now,
      });
      this.invalidateModelCache(binding.localUserId);
      return principalFromBinding(updated);
    }
    if (!response.ok) return principalFromBinding(binding);

    const account = parseRouterAccount(await response.json());
    if (!account || account.id !== binding.routerAccountId) {
      return principalFromBinding(binding);
    }
    const updated = await this.store.upsertBinding({
      ...binding,
      accountName: account.name,
      balance: account.balance,
      isAdmin:
        account.isAdmin === undefined ? binding.isAdmin : account.isAdmin,
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
    const gatewayKey = this.gatewayKeyFor(binding);
    this.clientConfig.ensureProvidersInstalled();
    const apiKeys = Object.fromEntries(
      this.clientConfig
        .providers()
        .map((provider) => [provider.providerId, gatewayKey]),
    );
    let managedSlotDefaults = this.managedSlotDefaults;
    try {
      const catalog = await this.listModels(principal);
      managedSlotDefaults = withManagedStorySchedule(
        managedSlotDefaults,
        await this.store.getModelSchedule(),
        catalog,
      );
      managedSlotDefaults = withManagedImageDefaults(
        managedSlotDefaults,
        catalog,
        this.preferredImageModel,
      );
    } catch {
      // Catalog discovery is optional for ordinary text calls. Keep the
      // configured managed defaults when Router model listing is unavailable.
    }
    return {
      principal,
      apiKeys,
      managedSlotDefaults,
      ...(!principal.isAdmin
        ? {
            managedModelPolicy:
              managedModelPolicyFromSlots(managedSlotDefaults),
          }
        : {}),
    };
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
    if (cached && cached.key === cacheKey) {
      return cached.value;
    }
    const pending = this.modelRequests.get(binding.localUserId);
    if (pending?.key === cacheKey) return pending.promise;
    if (pending) this.modelRequests.delete(binding.localUserId);

    const gatewayKey = this.gatewayKeyFor(binding);
    const request = (async () => {
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
          try {
            return await this.fetchChannelModels(provider, gatewayKey);
          } catch (error) {
            return {
              channelKey: provider.channelKey,
              providerId: provider.providerId,
              displayName: provider.displayName,
              enabled: true,
              protocol: provider.protocol,
              baseUrl: provider.baseUrl,
              models: [],
              error:
                error instanceof FrostFoxServiceError
                  ? error.code
                  : "channel_request_failed",
            };
          }
        }),
      );
      const value = {
        configurationVersion: this.clientConfig.snapshot.configurationVersion,
        channels,
      } satisfies FrostFoxModelCatalog;
      this.modelCache.set(binding.localUserId, {
        key: cacheKey,
        value,
      });
      return value;
    })();
    let tracked: Promise<FrostFoxModelCatalog>;
    tracked = request.finally(() => {
      if (this.modelRequests.get(binding.localUserId)?.promise === tracked) {
        this.modelRequests.delete(binding.localUserId);
      }
    });
    this.modelRequests.set(binding.localUserId, {
      key: cacheKey,
      promise: tracked,
    });
    return tracked;
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
    const models = parseModelList(body, provider);
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

  private fetchRouterAccount(accountKey: string): Promise<Response> {
    return this.fetchImpl(
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
  }

  private async readRouterAccount(accountKey: string): Promise<RouterAccount> {
    const response = await this.fetchRouterAccount(accountKey);
    if (!response.ok) {
      throw new FrostFoxServiceError("frostfox_account_unavailable", 401);
    }
    const account = parseRouterAccount(await response.json());
    if (!account) {
      throw new FrostFoxServiceError("frostfox_account_response_invalid", 502);
    }
    return {
      ...account,
      isAdmin: account.isAdmin === true,
    };
  }

  private async requiredBinding(localUserId: string): Promise<FrostFoxBinding> {
    const binding = await this.store.getBindingByLocalUserId(localUserId);
    if (!binding) {
      throw new FrostFoxServiceError("frostfox_session_invalid", 401);
    }
    return binding;
  }

  private invalidateModelCache(localUserId: string): void {
    this.modelCache.delete(localUserId);
    this.modelRequests.delete(localUserId);
  }

  private gatewayKeyFor(binding: FrostFoxBinding): string {
    return deriveFrostFoxGatewayKey(
      this.openAccountKey(binding),
      this.runtimeConfig.clientId,
    );
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

function normalizeScheduleEntries(
  entries: readonly FrostFoxModelScheduleEntry[],
): FrostFoxModelScheduleEntry[] {
  if (!Array.isArray(entries) || entries.length > 8) {
    throw new FrostFoxServiceError("frostfox_model_schedule_invalid", 400);
  }
  const seen = new Set<string>();
  const normalized: FrostFoxModelScheduleEntry[] = [];
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.channelKey !== "string" ||
      typeof entry.modelId !== "string"
    ) {
      throw new FrostFoxServiceError("frostfox_model_schedule_invalid", 400);
    }
    const channelKey = entry.channelKey.trim();
    const modelId = entry.modelId.trim();
    if (
      !channelKey ||
      channelKey.length > 64 ||
      !modelId ||
      modelId.length > 200
    ) {
      throw new FrostFoxServiceError("frostfox_model_schedule_invalid", 400);
    }
    const key = `${channelKey}\n${modelId}`;
    if (seen.has(key)) {
      throw new FrostFoxServiceError("frostfox_model_schedule_invalid", 400);
    }
    seen.add(key);
    normalized.push({ channelKey, modelId });
  }
  return normalized;
}

function withManagedStorySchedule(
  defaults: SlotOverridesInput | undefined,
  schedule: FrostFoxModelSchedule | null,
  catalog: FrostFoxModelCatalog,
): SlotOverridesInput | undefined {
  if (!schedule || schedule.story.length === 0) return defaults;

  const candidates: Array<{
    channel: FrostFoxModelChannel;
    model: FrostFoxModelEntry;
  }> = [];
  const seen = new Set<string>();
  for (const entry of schedule.story) {
    const channel = catalog.channels.find(
      (item) =>
        item.channelKey === entry.channelKey && item.enabled && !item.error,
    );
    const model = channel?.models.find((item) => item.id === entry.modelId);
    if (!channel || !model || !model.capability.output.includes("text")) {
      continue;
    }
    const key = `${channel.channelKey}\n${model.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ channel, model });
  }
  if (candidates.length === 0) return defaults;

  const slotPresetOverrides = { ...(defaults?.slotPresetOverrides ?? {}) };
  const customPresets = new Map(
    (defaults?.customPresets ?? []).map((preset) => [preset.id, preset]),
  );
  const presetIds = candidates.map(({ channel, model }) =>
    managedPresetId(channel.channelKey, model.id),
  );
  for (const [index, { channel, model }] of candidates.entries()) {
    customPresets.set(presetIds[index]!, {
      id: presetIds[index]!,
      name: `${channel.displayName} · ${model.name}`,
      provider: channel.providerId,
      baseUrl: channel.baseUrl,
      model: model.id,
      protocol: channel.protocol,
      tag: "text",
      ...(presetIds.slice(index + 1).length > 0
        ? { fallbackPresetIds: presetIds.slice(index + 1) }
        : {}),
    });
  }

  const previousStory = slotPresetOverrides.story;
  const primary = presetIds[0]!;
  slotPresetOverrides.story = primary;
  if (
    !slotPresetOverrides.default ||
    slotPresetOverrides.default === previousStory
  ) {
    slotPresetOverrides.default = primary;
  }
  if (
    !slotPresetOverrides.plugin ||
    slotPresetOverrides.plugin === previousStory
  ) {
    slotPresetOverrides.plugin = primary;
  }

  return {
    ...(defaults ?? {}),
    slotPresetOverrides,
    customPresets: [...customPresets.values()],
  };
}

function buildManagedSlotDefaults(
  ai: AiStack,
  clientConfig: FrostFoxClientConfigManager,
): SlotOverridesInput | undefined {
  const providersByChannel = new Map(
    clientConfig
      .providers()
      .map((provider) => [provider.channelKey, provider] as const),
  );
  const slotPresetOverrides: Record<string, string> = {};
  const customPresets = new Map<
    string,
    NonNullable<SlotOverridesInput["customPresets"]>[number]
  >();
  let textFallbackPresetId: string | undefined;

  for (const preset of ai.config.presets) {
    if (!preset.enabled || !preset.defaultSlot) continue;
    const provider = providersByChannel.get(preset.provider);
    if (!provider) continue;
    const id = managedPresetId(provider.channelKey, preset.model);
    slotPresetOverrides[preset.defaultSlot] = id;
    if (!textFallbackPresetId && (preset.tag ?? "text") === "text") {
      textFallbackPresetId = id;
    }
    customPresets.set(id, {
      id,
      name: `${provider.displayName} · ${preset.model}`,
      provider: provider.providerId,
      baseUrl: provider.baseUrl,
      model: preset.model,
      protocol: provider.protocol,
      tag:
        preset.tag ??
        (preset.capability?.output.includes("image")
          ? "image"
          : preset.capability?.output.includes("audio")
            ? "speech"
            : preset.capability?.output.includes("embedding")
              ? "embedding"
              : "text"),
    });
  }

  if (textFallbackPresetId) {
    slotPresetOverrides.plugin ??= textFallbackPresetId;
    slotPresetOverrides.default ??= textFallbackPresetId;
  }

  return Object.keys(slotPresetOverrides).length === 0
    ? undefined
    : {
        slotPresetOverrides,
        customPresets: [...customPresets.values()],
      };
}

function withManagedImageDefaults(
  defaults: SlotOverridesInput | undefined,
  catalog: FrostFoxModelCatalog,
  preferredModel: string | undefined,
): SlotOverridesInput | undefined {
  let firstImage:
    { channel: FrostFoxModelChannel; model: FrostFoxModelEntry } | undefined;
  let firstDedicatedImage:
    { channel: FrostFoxModelChannel; model: FrostFoxModelEntry } | undefined;
  let selected:
    { channel: FrostFoxModelChannel; model: FrostFoxModelEntry } | undefined;

  findImage: for (const channel of catalog.channels) {
    if (!channel.enabled || channel.error) continue;
    for (const model of channel.models) {
      if (!model.capability.output.includes("image")) continue;
      firstImage ??= { channel, model };
      if (channel.channelKey.toLowerCase() === "image") {
        firstDedicatedImage ??= { channel, model };
      }
      if (preferredModel && model.id === preferredModel) {
        selected = { channel, model };
        break findImage;
      }
    }
  }

  selected ??= firstDedicatedImage ?? firstImage;
  // No image model in the Router catalog: preserve the startup defaults and
  // let the caller's existing configuration decide whether image generation
  // is available. A partial/failed catalog must never erase a working route.
  if (!selected) return defaults;

  const imagePresetId = managedPresetId(
    selected.channel.channelKey,
    selected.model.id,
  );
  const slotPresetOverrides = {
    ...(defaults?.slotPresetOverrides ?? {}),
    // Router catalog selection is authoritative for hosted image calls. Do
    // not use `??=` here: a stale local/default image binding would otherwise
    // survive and make the UI and the server disagree about the target.
    image: imagePresetId,
  };
  const customPresets = new Map(
    (defaults?.customPresets ?? []).map((preset) => [preset.id, preset]),
  );
  // Drop stale managed image definitions. They are not active after the
  // assignment above, but retaining them needlessly enlarges every request's
  // overlay and can leave an old account/configuration visible to diagnostics.
  for (const [id, preset] of customPresets) {
    if (id.startsWith("frostfox-managed-") && preset.tag === "image") {
      customPresets.delete(id);
    }
  }
  customPresets.set(imagePresetId, {
    id: imagePresetId,
    name: `${selected.channel.displayName} · ${selected.model.name}`,
    provider: selected.channel.providerId,
    baseUrl: selected.channel.baseUrl,
    model: selected.model.id,
    protocol: selected.channel.protocol,
    tag: "image",
  });

  return {
    ...(defaults ?? {}),
    slotPresetOverrides,
    customPresets: [...customPresets.values()],
  };
}
function managedPresetId(channelKey: string, model: string): string {
  return `frostfox-managed-${createHash("sha256")
    .update(`${channelKey}\n${model}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function managedModelPolicyFromSlots(
  defaults: SlotOverridesInput | undefined,
): ManagedModelPolicy {
  const slots = defaults?.slotPresetOverrides ?? {};
  const first = (...slotIds: string[]): string | undefined => {
    for (const slotId of slotIds) {
      const presetId = slots[slotId];
      if (typeof presetId === "string" && presetId.length > 0) return presetId;
    }
    return undefined;
  };
  const presetIdsByTag: Record<string, string> = {};
  const text = first("story", "default", "plugin");
  const image = first("image");
  const embedding = first("embedding", "embed");
  const speech = first("speech");
  const transcription = first("transcription");
  if (text) presetIdsByTag.text = text;
  if (image) presetIdsByTag.image = image;
  if (embedding) presetIdsByTag.embedding = embedding;
  if (speech) presetIdsByTag.speech = speech;
  if (transcription) presetIdsByTag.transcription = transcription;
  return { presetIdsByTag };
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
    isAdmin: binding.isAdmin,
    credentialState: binding.credentialState,
    lastVerifiedAt: binding.lastVerifiedAt,
  };
}
function progressionStatus(
  completedLevel: number,
  updatedAt: string,
): FrostFoxProgressionStatus {
  return {
    completedLevel,
    unlockedLevel: Math.min(completedLevel + 1, FROSTFOX_LEVEL_COUNT),
    totalLevels: FROSTFOX_LEVEL_COUNT,
    updatedAt: updatedAt || null,
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

function parseModelList(
  value: unknown,
  provider: ManagedFrostFoxProvider,
): FrostFoxModelEntry[] {
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
      capability: resolveManagedModelCapability(item, provider),
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

function resolveManagedModelCapability(
  item: Record<string, unknown>,
  provider: ManagedFrostFoxProvider,
): ModelCapability {
  const capability = resolveCapabilityDetails(
    item.id as string,
    provider.channelKey,
    provider.protocol,
    readModelCapabilityOverride(item),
  ).capability;
  if (provider.channelKey.toLowerCase() !== "image") return capability;

  // FrostFox's image channel is the routing contract. Some OpenAI-compatible
  // `/models` responses omit modality metadata, which otherwise makes the
  // generic protocol fallback advertise every image generator as a text LLM.
  // Image-channel models support prompt + reference-image input and produce
  // image assets; token limits and chat-only feature flags are not applicable.
  return {
    input: ["text", "image"],
    output: ["image"],
    ...(capability.pricing ? { pricing: capability.pricing } : {}),
  };
}

function readModelCapabilityOverride(
  item: Record<string, unknown>,
): ManualCapabilityOverride | undefined {
  const declared = isRecord(item.capability)
    ? item.capability
    : isRecord(item.capabilities)
      ? item.capabilities
      : item;
  const input = readModalities(declared, "input");
  const output = readModalities(declared, "output");
  const imageGenerationDeclared = [
    declared.image_generation,
    declared.imageGeneration,
    declared.supports_image_generation,
    declared.supportsImageGeneration,
  ].some((value) => value === true);
  const mode = [
    item.mode,
    item.type,
    item.task,
    item.modelType,
    item.model_type,
  ].find((value): value is string => typeof value === "string");
  const normalizedMode = mode?.toLowerCase() ?? "";
  const derivedOutput =
    output ??
    (imageGenerationDeclared || normalizedMode.includes("image")
      ? (["image"] as OutputModality[])
      : normalizedMode.includes("embedding")
        ? (["embedding"] as OutputModality[])
        : normalizedMode.includes("speech")
          ? (["audio"] as OutputModality[])
          : undefined);
  const derivedInput =
    input ??
    (derivedOutput?.includes("image")
      ? (["text"] as InputModality[])
      : undefined);
  if (!derivedInput && !derivedOutput) return undefined;
  return {
    ...(derivedInput ? { input: derivedInput } : {}),
    ...(derivedOutput ? { output: derivedOutput } : {}),
  };
}

function readModalities(
  record: Record<string, unknown>,
  direction: "input",
): InputModality[] | undefined;
function readModalities(
  record: Record<string, unknown>,
  direction: "output",
): OutputModality[] | undefined;
function readModalities(
  record: Record<string, unknown>,
  direction: "input" | "output",
): InputModality[] | OutputModality[] | undefined {
  const keys =
    direction === "input"
      ? [
          "input",
          "input_modalities",
          "inputModalities",
          "supported_input_modalities",
          "supportedInputModalities",
        ]
      : [
          "output",
          "output_modalities",
          "outputModalities",
          "supported_output_modalities",
          "supportedOutputModalities",
        ];
  const raw = keys.map((key) => record[key]).find(Array.isArray);
  if (!Array.isArray(raw)) return undefined;
  const allowed: readonly string[] =
    direction === "input"
      ? ["text", "image", "audio", "video", "file"]
      : ["text", "image", "audio", "embedding"];
  const values = raw.filter(
    (value): value is string =>
      typeof value === "string" && allowed.includes(value),
  );
  if (values.length === 0) return undefined;
  return direction === "input"
    ? (values as InputModality[])
    : (values as OutputModality[]);
}

function parseRouterAccount(value: unknown): RouterAccountPayload | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    typeof value.balance !== "number" ||
    !Number.isFinite(value.balance) ||
    (value.isAdmin !== undefined && typeof value.isAdmin !== "boolean")
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    balance: value.balance,
    ...(value.isAdmin === undefined ? {} : { isAdmin: value.isAdmin }),
  };
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
