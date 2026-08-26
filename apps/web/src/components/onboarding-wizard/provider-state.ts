import type {
  FrostFoxModelCatalog,
  PresetSummary,
} from "@/services/api.js";
import { frostFoxModelRef } from "@/services/api.js";
import { PROVIDERS } from "./constants.js";
import type { ProviderFormState, SlotName } from "./types.js";

export function emptyFormState(
  initialProvider = PROVIDERS[0].id,
): ProviderFormState {
  return {
    selected: initialProvider,
    apiKey: "",
    keyVisible: false,
    builtInModel: "",
    customBaseUrl: "",
    customModel: "",
    customProviderName: "",
    managedModelRef: "",
    modelSource: "local",
  };
}

export function providerOptionLabel(providerId: string): string {
  return PROVIDERS.find((item) => item.id === providerId)?.name ?? providerId;
}

export function modelOptionsForProvider(
  presets: PresetSummary[],
  providerId: string,
): string[] {
  return [
    ...new Set(
      presets
        .filter((preset) => preset.enabled && preset.provider === providerId)
        .map((preset) => preset.model),
    ),
  ];
}

export function defaultModelForProvider(
  presets: PresetSummary[],
  providerId: string,
): string {
  return modelOptionsForProvider(presets, providerId)[0] ?? "";
}

export interface ManagedModelOption {
  ref: string;
  name: string;
  channelName: string;
  model: string;
}

export function managedModelOptions(
  catalog: FrostFoxModelCatalog | null,
  slotName: SlotName,
): ManagedModelOption[] {
  if (!catalog) return [];

  return catalog.channels.flatMap((channel) =>
    channel.enabled && !channel.error
      ? channel.models
          .filter((model) =>
            slotName === "story" || slotName === "plugin"
              ? model.capability.output.includes("text")
              : true,
          )
          .map((model) => ({
            ref: frostFoxModelRef(channel.channelKey, model.id),
            name: model.name,
            channelName: channel.displayName,
            model: model.id,
          }))
      : [],
  );
}

export function defaultManagedModelRef(
  catalog: FrostFoxModelCatalog | null,
  slotName: SlotName,
): string {
  return managedModelOptions(catalog, slotName)[0]?.ref ?? "";
}

export function managedModelOptionForRef(
  catalog: FrostFoxModelCatalog | null,
  slotName: SlotName,
  ref: string,
): ManagedModelOption | undefined {
  return managedModelOptions(catalog, slotName).find(
    (option) => option.ref === ref,
  );
}

export function managedFormIsReady(
  form: ProviderFormState,
  catalog: FrostFoxModelCatalog | null,
  slotName: SlotName,
): boolean {
  return (
    form.modelSource === "managed" &&
    !!managedModelOptionForRef(catalog, slotName, form.managedModelRef)
  );
}

export function defaultManagedFormState(
  form: ProviderFormState,
  catalog: FrostFoxModelCatalog | null,
  slotName: SlotName,
): ProviderFormState {
  if (form.modelSource !== "managed" || form.managedModelRef.trim()) {
    return form;
  }
  const option = managedModelOptions(catalog, slotName)[0];
  return option
    ? { ...form, managedModelRef: option.ref, apiKey: "" }
    : form;
}
