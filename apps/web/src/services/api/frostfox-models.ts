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
let managedHydrationVersion = 0;
let managedCatalogRevision = 0;
const managedCatalogListeners = new Set<() => void>();

function publishManagedFrostFoxCatalog(
  catalog: FrostFoxModelCatalog | null,
): void {
  managedCatalog = catalog;
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
  const hydrationVersion = ++managedHydrationVersion;
  try {
    const account = accountStatus ?? (await fetchFrostFoxAccount(true));
    if (hydrationVersion !== managedHydrationVersion) return null;
    if (!account.enabled || !account.authenticated) {
      publishManagedFrostFoxCatalog(null);
      return null;
    }
    const catalog = await fetchFrostFoxModels(true);
    if (hydrationVersion !== managedHydrationVersion) return null;
    publishManagedFrostFoxCatalog(catalog);
    return catalog;
  } catch {
    if (hydrationVersion === managedHydrationVersion)
      publishManagedFrostFoxCatalog(null);
    return null;
  }
}
