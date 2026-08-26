import {
  fetchFrostFoxAccount,
  fetchFrostFoxModels,
  type FrostFoxAccountStatus,
  type FrostFoxModelCatalog,
} from "./frostfox.js";
import type { PresetSummary } from "./types.js";
import type { CustomPreset } from "./model-settings.js";

const FROSTFOX_MODEL_REF_PREFIX = "frostfox:";
const LEGACY_MANAGED_MODEL_REF_PREFIX = "frostfox-managed-";
let managedCatalog: FrostFoxModelCatalog | null = null;
let managedCatalogAccountId: string | null = null;
let managedHydrationVersion = 0;
let managedHydrationPromise: Promise<FrostFoxModelCatalog | null> | null = null;
let managedHydrationAccountId: string | null = null;
let managedHydrationAttemptedAccountId: string | null = null;
let managedCatalogRevision = 0;
const managedCatalogListeners = new Set<() => void>();

function publishManagedFrostFoxCatalog(
  catalog: FrostFoxModelCatalog | null,
  accountId: string | null = null,
): void {
  managedCatalog = catalog;
  managedCatalogAccountId = catalog ? accountId : null;
  managedCatalogRevision += 1;
  for (const listener of managedCatalogListeners) listener();
}

export function subscribeManagedFrostFoxCatalog(
  listener: () => void,
): () => void {
  managedCatalogListeners.add(listener);
  return () => managedCatalogListeners.delete(listener);
}

export function getManagedFrostFoxCatalogRevision(): number {
  return managedCatalogRevision;
}

export function setManagedFrostFoxCatalog(
  catalog: FrostFoxModelCatalog | null,
): void {
  managedHydrationVersion += 1;
  managedHydrationPromise = null;
  managedHydrationAccountId = null;
  managedHydrationAttemptedAccountId = null;
  publishManagedFrostFoxCatalog(catalog);
}

export function getManagedFrostFoxCatalog(): FrostFoxModelCatalog | null {
  return managedCatalog;
}

export function frostFoxModelRef(channelKey: string, modelId: string): string {
  return `${FROSTFOX_MODEL_REF_PREFIX}${encodeURIComponent(channelKey)}:${encodeURIComponent(modelId)}`;
}

export function getManagedFrostFoxPresets(): CustomPreset[] {
  if (!managedCatalog) return [];
  return managedCatalog.channels.flatMap((channel) =>
    channel.enabled && !channel.error
      ? channel.models.map((model) => ({
          id: frostFoxModelRef(channel.channelKey, model.id),
          name: `${channel.displayName} · ${model.name}`,
          provider: channel.providerId,
          baseUrl: channel.baseUrl,
          model: model.id,
          protocol: channel.protocol,
          tag: model.capability.output.includes("image")
            ? "image"
            : model.capability.output.includes("audio")
              ? "speech"
              : model.capability.output.includes("embedding")
                ? "embedding"
                : "text",
          capability: model.capability,
        }))
      : [],
  );
}

export function isManagedFrostFoxModelRef(value: string): boolean {
  return (
    value.startsWith(FROSTFOX_MODEL_REF_PREFIX) ||
    value.startsWith(LEGACY_MANAGED_MODEL_REF_PREFIX)
  );
}

export function managedCatalogToPresetSummaries(
  catalog: FrostFoxModelCatalog | null,
): PresetSummary[] {
  if (!catalog) return [];
  return catalog.channels.flatMap((channel) =>
    channel.enabled && !channel.error
      ? channel.models.map((model) => ({
          id: frostFoxModelRef(channel.channelKey, model.id),
          name: `${channel.displayName} · ${model.name}`,
          provider: channel.providerId,
          model: model.id,
          enabled: true,
          isDefault: false,
          scope: "frostfox",
          baseUrl: channel.baseUrl,
          protocol: channel.protocol,
          capability: model.capability,
        }))
      : [],
  );
}

export function getManagedFrostFoxPresetSummaries(): PresetSummary[] {
  return managedCatalogToPresetSummaries(managedCatalog);
}

export async function hydrateManagedFrostFoxModels(
  accountStatus?: FrostFoxAccountStatus,
): Promise<FrostFoxModelCatalog | null> {
  let account: FrostFoxAccountStatus;
  try {
    account = accountStatus ?? (await fetchFrostFoxAccount(true));
  } catch {
    return null;
  }
  const accountId =
    account.enabled && account.authenticated && account.account
      ? account.account.id
      : null;

  if (!accountId) {
    const hadManagedState =
      managedCatalog !== null ||
      managedCatalogAccountId !== null ||
      managedHydrationPromise !== null ||
      managedHydrationAttemptedAccountId !== null;
    if (hadManagedState) {
      managedHydrationVersion += 1;
      managedHydrationPromise = null;
      managedHydrationAccountId = null;
      managedHydrationAttemptedAccountId = null;
      if (managedCatalog !== null || managedCatalogAccountId !== null) {
        publishManagedFrostFoxCatalog(null);
      }
    }
    return null;
  }

  if (managedCatalog && managedCatalogAccountId === accountId) {
    return managedCatalog;
  }
  if (managedHydrationPromise && managedHydrationAccountId === accountId) {
    return managedHydrationPromise;
  }
  if (managedHydrationAttemptedAccountId === accountId) {
    return managedCatalog;
  }

  // A login for a different account invalidates both the visible catalog and
  // any in-flight request from the previous account. The old promise may
  // still settle, but its version no longer permits it to publish.
  if (managedHydrationPromise) {
    managedHydrationVersion += 1;
    managedHydrationPromise = null;
    managedHydrationAccountId = null;
    managedHydrationAttemptedAccountId = null;
  }
  if (managedCatalog && managedCatalogAccountId !== accountId) {
    managedHydrationVersion += 1;
    publishManagedFrostFoxCatalog(null);
  }

  const hydrationVersion = ++managedHydrationVersion;
  managedHydrationAccountId = accountId;
  managedHydrationAttemptedAccountId = accountId;
  let request: Promise<FrostFoxModelCatalog | null>;
  request = fetchFrostFoxModels(true)
    .then((catalog) => {
      if (hydrationVersion !== managedHydrationVersion) return null;
      publishManagedFrostFoxCatalog(catalog, accountId);
      return catalog;
    })
    .catch(() => {
      if (hydrationVersion === managedHydrationVersion) {
        publishManagedFrostFoxCatalog(null);
      }
      return null;
    })
    .finally(() => {
      if (managedHydrationPromise === request) {
        managedHydrationPromise = null;
        managedHydrationAccountId = null;
      }
    });
  managedHydrationPromise = request;
  return request;
}
