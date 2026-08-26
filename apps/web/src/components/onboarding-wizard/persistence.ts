import {
  getProviderKeys,
  setProviderKeys,
  getCustomPresets,
  setCustomPresets,
  listPresets,
  getSlotConfig,
  setSlotConfig,
  isManagedFrostFoxModelRef,
  slotBindingId,
} from "@/services/api.js";
import type { CustomPreset, PresetSummary } from "@/services/api.js";
import { invalidatePingResult } from "@/components/shared/ping-button.js";
import { getSettings } from "@/settings/store";
import { CUSTOM_PROVIDER_ID, ONBOARDING_VERSION } from "./constants.js";
import { providerOptionLabel } from "./provider-state.js";
import type { ProviderFormState, SlotName } from "./types.js";

const ONBOARDING_ACCOUNT_KEY = "ui.onboardedAccountId";

export function isOnboarded(accountId?: string | null): boolean {
  const stored = getSettings().get<number>("ui.onboardedVersion");
  if (typeof stored !== "number" || stored < ONBOARDING_VERSION) return false;
  if (!accountId) return true;
  return getSettings().get<string>(ONBOARDING_ACCOUNT_KEY) === accountId;
}

export async function markOnboarded(accountId?: string | null): Promise<void> {
  const store = getSettings();
  const previousVersion = store.get<number>("ui.onboardedVersion");
  const previousAccount = store.get<string>(ONBOARDING_ACCOUNT_KEY);
  try {
    // Persist the version first. If the account marker write fails, the old
    // marker still prevents the new account from being treated as complete.
    await store.set("ui.onboardedVersion", ONBOARDING_VERSION);
    if (accountId) {
      await store.set(ONBOARDING_ACCOUNT_KEY, accountId);
    } else {
      await store.clear(ONBOARDING_ACCOUNT_KEY);
    }
  } catch (error) {
    // Settings writes are separate adapter operations. Restore both values so
    // a partial desktop/localStorage write cannot leave a false completion.
    try {
      if (typeof previousVersion === "number") {
        await store.set("ui.onboardedVersion", previousVersion);
      } else {
        await store.clear("ui.onboardedVersion");
      }
    } catch {
      // Preserve the original failure; the next mount will remain fail-closed
      // unless the adapter happened to persist the first write.
    }
    try {
      if (typeof previousAccount === "string" && previousAccount.length > 0) {
        await store.set(ONBOARDING_ACCOUNT_KEY, previousAccount);
      } else {
        await store.clear(ONBOARDING_ACCOUNT_KEY);
      }
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

/** Force the onboarding wizard to appear again on next mount. Used by Settings "re-run tutorial". */
export function resetOnboarding(): void {
  const store = getSettings();
  void store
    .clear("ui.onboardedVersion")
    .then(() => store.clear(ONBOARDING_ACCOUNT_KEY));
}

/**
 * Drop stale cached Ping results when the form inputs change — otherwise a
 * green badge from a previous URL/key combination can linger and mislead.
 */
export function clearCachedPing(slotName: SlotName): void {
  invalidatePingResult({ kind: "slot", slotId: slotName });
}

function findReusableCustomPreset(
  expected: Pick<CustomPreset, "provider" | "model" | "baseUrl" | "protocol">,
): CustomPreset | undefined {
  return getCustomPresets().find(
    (preset) =>
      preset.provider === expected.provider &&
      preset.model === expected.model &&
      (preset.baseUrl ?? "") === (expected.baseUrl ?? "") &&
      (preset.protocol ?? "") === (expected.protocol ?? ""),
  );
}

function upsertTransientPreset(input: Omit<CustomPreset, "id">): string {
  const existing = findReusableCustomPreset(input);
  if (existing) return existing.id;

  const nextPreset: CustomPreset = {
    ...input,
    id: `custom_${crypto.randomUUID()}`,
  };
  setCustomPresets([...getCustomPresets(), nextPreset]);
  return nextPreset.id;
}

/** Persist the model chosen for an onboarding slot. Managed FrostFox models
 * already carry their trusted provider definition and credential server-side,
 * so only the model reference is stored. Local providers keep the existing
 * key + preset path below. */
export async function persistSlot(
  form: ProviderFormState,
  slotName: SlotName,
  presetCatalog: PresetSummary[],
): Promise<string | undefined> {
  if (form.modelSource === "managed") {
    const modelRef = form.managedModelRef.trim();
    const isKnownManagedModel = presetCatalog.some(
      (preset) =>
        preset.id === modelRef && preset.enabled && preset.scope === "frostfox",
    );
    if (
      !modelRef ||
      !isManagedFrostFoxModelRef(modelRef) ||
      !isKnownManagedModel
    ) {
      return undefined;
    }
    const slots = getSlotConfig();
    setSlotConfig({ ...slots, [slotName]: { modelRef } });
    return modelRef;
  }

  const key = form.apiKey.trim();
  if (!key) return undefined;

  const isCustom = form.selected === CUSTOM_PROVIDER_ID;

  if (isCustom) {
    const provName = form.customProviderName.trim() || "custom";
    const existingKeys = getProviderKeys();
    setProviderKeys({ ...existingKeys, [provName]: key });

    const presetId = upsertTransientPreset({
      name: `${provName} — ${form.customModel || "default"}`,
      provider: provName,
      baseUrl: form.customBaseUrl.trim(),
      model: form.customModel.trim() || "default",
      protocol: "openai-chat-v1",
      apiKey: key,
    });
    const slots = getSlotConfig();
    setSlotConfig({ ...slots, [slotName]: { presetId } });
    return presetId;
  }

  const existingKeys = getProviderKeys();
  setProviderKeys({ ...existingKeys, [form.selected]: key });
  const desiredModel = form.builtInModel.trim();
  if (!desiredModel) return undefined;

  try {
    const presets =
      presetCatalog.length > 0 ? presetCatalog : await listPresets();
    const match = presets.find(
      (p) =>
        p.provider === form.selected && p.enabled && p.model === desiredModel,
    );
    if (match) {
      const slots = getSlotConfig();
      setSlotConfig({ ...slots, [slotName]: { presetId: match.id } });
      return match.id;
    }

    const presetId = upsertTransientPreset({
      name: `${providerOptionLabel(form.selected)} — ${desiredModel}`,
      provider: form.selected,
      model: desiredModel,
      baseUrl: "",
      apiKey: key,
    });
    const slots = getSlotConfig();
    setSlotConfig({ ...slots, [slotName]: { presetId } });
    return presetId;
  } catch {
    // Network hiccup — leave slot config untouched so the ping probe
    // surfaces the real problem to the user.
  }
  return undefined;
}

export function bindPluginSlotToStory(): void {
  const slots = getSlotConfig();
  const storyBinding = slotBindingId(slots.story);
  const pluginBinding = slotBindingId(slots.plugin);
  if (storyBinding && pluginBinding !== storyBinding) {
    setSlotConfig({ ...slots, plugin: slots.story! });
  }
}

export function persistPluginModeSame(): void {
  const slots = getSlotConfig();
  if (slots.story) {
    setSlotConfig({ ...slots, plugin: slots.story });
    return;
  }

  const { plugin: _drop, ...rest } = slots;
  setSlotConfig(rest);
}
