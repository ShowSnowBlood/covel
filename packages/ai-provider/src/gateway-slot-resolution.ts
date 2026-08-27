import type { ProviderDefaults } from "./types.js";
import type { ProviderResolution } from "./provider-registry.js";
import type { SlotRegistry } from "./slot-registry.js";
import {
  applySlotOverlay,
  publicPresetId,
  resolveOverlayPresetId,
  resolveSlotOverride,
} from "./slot-overlay.js";
import { targetModel, targetProvider } from "./gateway-lifecycle.js";
import type {
  ManagedModelPolicy,
  ModelParameterOverrides,
  OperationMode,
  PresetConfig,
  ProviderProtocol,
  ResolvedSlotConfig,
  ResolvedTarget,
  SlotOverridesInput,
} from "./types.js";

export interface GatewaySlotResolutionDependencies {
  providerRegistry: {
    resolve(
      target: {
        provider: string;
        baseUrl?: string;
        protocol?: ProviderProtocol;
      },
      options?: { mode: OperationMode },
    ): ProviderResolution;
    withApiKeys(
      resolution: ProviderResolution,
      apiKeys: Record<string, string>,
      providerName: string,
      envApiKeys?: Record<string, string>,
    ): ProviderResolution;
    hasProvider?(name: string): boolean;
    addProvider?(name: string, defaults: ProviderDefaults): void;
    removeProvider?(name: string): void;
  };
  presetRegistry: {
    resolveTextTarget(input: { presetId?: string }): ResolvedTarget;
    hasPreset?(id: string): boolean;
    addPreset?(preset: PresetConfig): void;
    removePreset?(id: string): void;
  };
  slotRegistry?: SlotRegistry;
}

export interface GatewayOptions {
  /**
   * Server-owned model policy. When present, the preset selected for the
   * operation's fallback tag wins over every caller-supplied preset or slot.
   */
  managedModelPolicy?: ManagedModelPolicy;
  /**
   * Request-supplied API keys (X-Provider-Keys header). Applied to any
   * resolved target — the caller explicitly chose to send these keys.
   */
  apiKeys?: Record<string, string>;
  /** Server-env keys — origin-gated by the gateway, unlike apiKeys. */
  envApiKeys?: Record<string, string>;
  /** Trace ID for observability. */
  traceId?: string;
  /** Slot-level parameter overrides resolved from the slot registry. */
  parameterOverrides?: ModelParameterOverrides;
  /** Abort signal for cancellation (e.g. budget timeout). */
  signal?: AbortSignal;
  /**
   * Per-request overlay that transiently extends the gateway's preset /
   * provider / slot view.
   */
  slotOverrides?: SlotOverridesInput;
  /**
   * Managed account schedules may continue to the next configured provider
   * when a provider returns an authentication/availability 4xx.
   */
  allowProviderFallbackOnClientError?: boolean;
}

export interface GatewaySlotResolution {
  resolveSlotOrPassthrough(
    presetId: string | undefined,
    fallbackTag?: string,
    options?: GatewayOptions,
  ): string | undefined;
  resolveParameterOverrides(
    presetId: string | undefined,
    options: GatewayOptions | undefined,
  ): ModelParameterOverrides | undefined;
  withParameterOverrides(
    metadata: Record<string, unknown> | undefined,
    presetId: string | undefined,
    options: GatewayOptions | undefined,
  ): Record<string, unknown> | undefined;
  withPresetMetadata(
    target: ResolvedTarget,
    metadata: Record<string, unknown> | undefined,
    presetId: string | undefined,
    options: GatewayOptions | undefined,
  ): Record<string, unknown> | undefined;
  resolveSlot(
    presetId: string | undefined,
    options?: GatewayOptions & { fallbackTag?: string },
  ): ResolvedSlotConfig | null;
}

export function createGatewaySlotResolution(
  deps: GatewaySlotResolutionDependencies,
  warnedFallbacks: Set<string>,
): GatewaySlotResolution {
  function presetTag(presetId: string): string | undefined {
    try {
      const preset = deps.presetRegistry.resolveTextTarget({ presetId }).preset;
      if (!preset) return undefined;
      if (preset.tag) return preset.tag;
      if (preset.capability?.output.includes("image")) return "image";
      if (preset.capability?.output.includes("audio")) return "speech";
      if (preset.capability?.output.includes("embedding")) return "embedding";
      if (preset.supportedModes.includes("image")) return "image";
      if (preset.supportedModes.includes("speech")) return "speech";
      if (preset.supportedModes.includes("embed")) return "embedding";
      if (preset.supportedModes.includes("transcription")) {
        return "transcription";
      }
      if (
        preset.supportedModes.some((mode) =>
          ["text", "object", "stream"].includes(mode),
        )
      ) {
        return "text";
      }
    } catch {
      // Unknown slot/preset — preserve the existing explicit error path.
    }
    return undefined;
  }

  function requestPresetId(
    presetId: string,
    options: GatewayOptions | undefined,
  ): string {
    return (
      resolveOverlayPresetId(
        presetId,
        options?.slotOverrides,
        (id) => deps.presetRegistry.hasPreset?.(id) ?? false,
      ) ?? presetId
    );
  }

  function firstCompatiblePreset(
    requestedId: string,
    fallbackTag: string,
    options: GatewayOptions | undefined,
  ): string | undefined {
    const slots = deps.slotRegistry;

    // Prefer another request-scoped slot mapping. Hosted account defaults and
    // browser-only presets live here, not in the process-wide slot registry.
    for (const [slotId, mappedPresetId] of Object.entries(
      options?.slotOverrides?.slotPresetOverrides ?? {},
    )) {
      if (slotId === requestedId) continue;
      const effectivePresetId = requestPresetId(mappedPresetId, options);
      const tag = presetTag(effectivePresetId) ?? slots?.getSlotTag(slotId);
      if (tag === fallbackTag) return effectivePresetId;
    }

    const direct = slots?.resolveSlot(requestedId);
    const directTag =
      slots?.getSlotTag(requestedId) ??
      (direct ? presetTag(direct) : undefined);
    if (direct && directTag === fallbackTag) {
      return direct;
    }

    if (presetTag(requestedId) === fallbackTag) return requestedId;
    return slots?.listSlotsByTag(fallbackTag)[0]?.presetId;
  }

  function fallbackForCrossTag(
    requestedId: string,
    actualTag: string,
    fallbackTag: string,
    options: GatewayOptions | undefined,
  ): string {
    const fallback = firstCompatiblePreset(requestedId, fallbackTag, options);
    if (!fallback) {
      throw new Error(
        `slot "${requestedId}" resolved to tag "${actualTag}", but no "${fallbackTag}" slot is configured`,
      );
    }

    const key = `${requestedId}(${actualTag})→${fallback}(${fallbackTag})`;
    if (!warnedFallbacks.has(key)) {
      warnedFallbacks.add(key);
      console.warn(
        `[ai-gateway] slot "${requestedId}" resolved to tag "${actualTag}" but "${fallbackTag}" was requested; falling back to "${fallback}"`,
      );
    }
    return fallback;
  }

  /**
   * Resolve a slot name to its preset ID.
   *
   * If the slot isn't configured, fall back to the first registered slot
   * whose tag matches `fallbackTag`. Request-scoped slot overrides use the
   * same compatibility check as process-wide slots; otherwise a stale
   * runtime override such as `text-runtime → image` can send a chat request
   * to an image model before the slot registry gets a chance to protect it.
   * Cross-tag fallback is never allowed.
   */
  function resolveSlotOrPassthrough(
    presetId: string | undefined,
    fallbackTag: string = "text",
    options?: GatewayOptions,
  ): string | undefined {
    // A present policy is authoritative even when it has no entry for the
    // requested modality. Never fall back to a caller-selected or process
    // default preset in that case; doing so would let a missing managed image
    // or embedding route spend against an unrelated local provider.
    const managedPolicy = options?.managedModelPolicy;
    if (managedPolicy) {
      const managedPresetId = managedPolicy.presetIdsByTag[fallbackTag];
      if (managedPresetId) return requestPresetId(managedPresetId, options);
      throw new Error(
        `managed model policy has no preset for tag "${fallbackTag}"`,
      );
    }
    if (!presetId) return presetId;
    const clientOverride = resolveSlotOverride(
      presetId,
      options?.slotOverrides,
    );
    const effectiveClientId = requestPresetId(
      clientOverride ?? presetId,
      options,
    );
    const clientTag =
      presetTag(effectiveClientId) ??
      (clientOverride
        ? deps.slotRegistry?.getSlotTag(clientOverride)
        : undefined);

    const tagSensitive = fallbackTag === "text" || fallbackTag === "image";
    if (effectiveClientId !== presetId) {
      if (tagSensitive && clientTag && clientTag !== fallbackTag) {
        return fallbackForCrossTag(presetId, clientTag, fallbackTag, options);
      }
      return effectiveClientId;
    }

    const direct = deps.slotRegistry?.resolveSlot(presetId);
    const directTag = deps.slotRegistry?.getSlotTag(presetId);
    const knownTag = presetTag(presetId) ?? directTag;
    if (tagSensitive && knownTag && knownTag !== fallbackTag) {
      return fallbackForCrossTag(presetId, knownTag, fallbackTag, options);
    }

    // Direct preset-id match trumps slot lookup. Without this, a raw preset
    // id could be diverted into the first same-tag slot.
    if (deps.presetRegistry.hasPreset?.(presetId)) return presetId;
    if (direct) return direct;

    const candidates = deps.slotRegistry?.listSlotsByTag(fallbackTag) ?? [];
    if (candidates.length === 0) return presetId;
    const fallback = candidates[0]!;
    const key = `${presetId}→${fallback.slotId}`;
    if (!warnedFallbacks.has(key)) {
      warnedFallbacks.add(key);
      console.warn(
        `[ai-gateway] slot "${presetId}" not configured; falling back to "${fallback.slotId}" ` +
          `(same tag="${fallbackTag}"). Add [covel.${presetId}] to llm.toml to silence.`,
      );
    }
    return fallback.presetId;
  }

  /**
   * Get parameter overrides for a given slot ID.
   */
  function getSlotParameterOverrides(
    slotId: string,
  ): ModelParameterOverrides | undefined {
    return deps.slotRegistry?.getParameterOverrides(slotId);
  }

  function resolveParameterOverrides(
    presetId: string | undefined,
    options: GatewayOptions | undefined,
  ): ModelParameterOverrides | undefined {
    if (options?.parameterOverrides) return options.parameterOverrides;
    if (!presetId) return undefined;
    const requestScoped =
      options?.slotOverrides?.parameterOverrides?.[presetId];
    if (requestScoped) return requestScoped;
    return getSlotParameterOverrides(presetId);
  }

  function withParameterOverrides(
    metadata: Record<string, unknown> | undefined,
    presetId: string | undefined,
    options: GatewayOptions | undefined,
  ): Record<string, unknown> | undefined {
    const parameterOverrides = resolveParameterOverrides(presetId, options);
    if (!metadata && !parameterOverrides) return metadata;
    return {
      ...metadata,
      ...(parameterOverrides ? { parameterOverrides } : {}),
    };
  }

  /**
   * Fold the preset's slot-wide `providerRequestMetadata` (thinking mode,
   * reasoning_effort, freeform provider flags) into the per-call metadata.
   *
   * Precedence: preset defaults < per-call metadata < parameterOverrides.
   * Per-call values always win so callers can override the TOML defaults.
   */
  function withPresetMetadata(
    target: ResolvedTarget,
    metadata: Record<string, unknown> | undefined,
    presetId: string | undefined,
    options: GatewayOptions | undefined,
  ): Record<string, unknown> | undefined {
    const presetMeta = target.preset?.providerRequestMetadata;
    const merged =
      presetMeta || metadata ? { ...presetMeta, ...metadata } : undefined;
    return withParameterOverrides(merged, presetId, options);
  }

  /**
   * Resolve a slot/preset id into a public, immutable configuration view
   * suitable for plugin-side wire calls.
   *
   * Plugins that own their own image/audio/custom wire format use this in
   * preference to the high-level helpers (`generateImage`, `embed`, …):
   * the framework picks the right preset, applies request-scoped
   * overlays + API keys, and hands back `{ baseUrl, apiKey, model, … }`
   * without forcing the call through a built-in adapter. The plugin
   * decides whether to use Vercel AI SDK, the OpenAI SDK, raw fetch, a
   * custom polling state machine, etc.
   *
   * Returns `null` when no slot can be resolved (typical when llm.toml is
   * empty AND no per-request override applies). Throws when the preset
   * registry rejects the resolved id (e.g. malformed config).
   */
  function resolveSlot(
    presetId: string | undefined,
    options?: GatewayOptions & { fallbackTag?: string },
  ): ResolvedSlotConfig | null {
    const cleanup = applySlotOverlay(deps, options?.slotOverrides);
    try {
      const tag = options?.fallbackTag ?? "text";
      const effectivePresetId = resolveSlotOrPassthrough(
        presetId,
        tag,
        options,
      );
      if (!effectivePresetId) return null;

      const target = deps.presetRegistry.resolveTextTarget({
        presetId: effectivePresetId,
      });
      let resolved = deps.providerRegistry.resolve(
        target.preset ?? target.profile,
        { mode: tag === "image" ? "image" : "text" },
      );
      if (options?.apiKeys || options?.envApiKeys) {
        resolved = deps.providerRegistry.withApiKeys(
          resolved,
          options.apiKeys ?? {},
          targetProvider(target),
          options.envApiKeys,
        );
      }

      const provider = targetProvider(target);
      const model = targetModel(target);
      const protocol = target.preset?.protocol ?? resolved.protocol;
      const baseUrl = resolved.config.baseUrl ?? target.preset?.baseUrl;
      const presetTagValue = presetTag(effectivePresetId) ?? "text";
      const presetMeta = target.preset?.providerRequestMetadata ?? {};
      const parameterOverrides = resolveParameterOverrides(presetId, options);

      // Surface llm.toml's free-form fields (embeddingFormat + any future
      // per-slot hints) under a single `metadata` bag the plugin owns.
      // This is the contract that lets new plugin formats declare bespoke
      // slot fields without framework changes.
      const metadata: Record<string, unknown> = {
        ...presetMeta,
        ...(target.preset?.embeddingFormat !== undefined
          ? { embeddingFormat: target.preset.embeddingFormat }
          : {}),
      };

      return {
        // Overlay registrations use internal scoped ids — surface the
        // public id so plugins see the id the request actually asked for.
        presetId: publicPresetId(effectivePresetId),
        provider,
        protocol: protocol as string,
        ...(baseUrl ? { baseUrl } : {}),
        ...(resolved.config.apiKey ? { apiKey: resolved.config.apiKey } : {}),
        ...(resolved.config.headers
          ? { headers: { ...resolved.config.headers } }
          : {}),
        model,
        tag: presetTagValue,
        metadata,
        ...(parameterOverrides ? { parameterOverrides } : {}),
      };
    } finally {
      cleanup();
    }
  }

  return {
    resolveSlotOrPassthrough,
    resolveParameterOverrides,
    withParameterOverrides,
    withPresetMetadata,
    resolveSlot,
  };
}
