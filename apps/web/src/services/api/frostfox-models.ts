import {
  fetchFrostFoxAccount,
  fetchFrostFoxModels,
  type FrostFoxAccountStatus,
  type FrostFoxModelCatalog,
} from "./frostfox.js";
import type { CustomPreset } from "./model-settings.js";

const FROSTFOX_MODEL_REF_PREFIX = "frostfox:";
let managedCatalog: FrostFoxModelCatalog | null = null;

export function setManagedFrostFoxCatalog(
  catalog: FrostFoxModelCatalog | null,
): void {
  managedCatalog = catalog;
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
          capability: model.capability,
        }))
      : [],
  );
}

export async function hydrateManagedFrostFoxModels(
  accountStatus?: FrostFoxAccountStatus,
): Promise<void> {
  try {
    const account = accountStatus ?? (await fetchFrostFoxAccount(true));
    if (!account.enabled || !account.authenticated) {
      managedCatalog = null;
      return;
    }
    managedCatalog = await fetchFrostFoxModels(true);
  } catch {
    managedCatalog = null;
  }
}
