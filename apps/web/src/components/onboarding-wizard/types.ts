import type { FrostFoxModelCatalog, PresetSummary } from "@/services/api.js";
import type { SupportedLocale } from "@/hooks/useLocalePreference";

export type OnboardingStep = 0 | 1 | 2 | 3;

export type ProviderId = "deepseek" | "openai" | "anthropic" | "dashscope";

export type SlotName = "story" | "plugin";

export type ModelSource = "managed" | "local";

export type PluginMode = "same" | "different";

export interface ProviderOption {
  id: ProviderId;
  name: string;
  placeholder: string;
  keyEnv: string;
}

export interface ProviderFormState {
  selected: string;
  apiKey: string;
  keyVisible: boolean;
  builtInModel: string;
  customBaseUrl: string;
  customModel: string;
  customProviderName: string;
  managedModelRef: string;
  modelSource: ModelSource;
}

export interface ProviderFormProps {
  state: ProviderFormState;
  onChange: (next: ProviderFormState) => void;
  onBeforePing: () => Promise<void>;
  presets: PresetSummary[];
  managedCatalog?: FrostFoxModelCatalog | null;
  managedOnly?: boolean;
  slotName: SlotName;
}

export interface LocaleControlsProps {
  locale: SupportedLocale;
  setLocale: (next: SupportedLocale) => void;
}
