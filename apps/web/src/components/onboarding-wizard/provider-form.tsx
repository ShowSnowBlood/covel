import { useTranslation } from "react-i18next";
import { Cloud, Eye, EyeOff, KeyRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Label } from "@/components/ui/label.js";
import { getProviderKeys } from "@/services/api.js";
import { PingButton } from "@/components/shared/ping-button.js";
import { CUSTOM_PROVIDER_ID, PROVIDERS } from "./constants.js";
import { clearCachedPing } from "./persistence.js";
import {
  defaultModelForProvider,
  managedFormIsReady,
  managedModelOptions,
  modelOptionsForProvider,
  preferredManagedModelOption,
} from "./provider-state.js";
import type {
  ModelSource,
  ProviderFormProps,
  ProviderFormState,
} from "./types.js";

/**
 * Provider picker + API key form. Reused for both the story slot (narrator)
 * and the plugin slot. Parent owns the state so tests / ping results stay
 * independent per slot.
 */
export function ProviderForm({
  state,
  onChange,
  onBeforePing,
  onRefreshManagedModels,
  presets,
  managedCatalog = null,
  managedModelsLoading = false,
  managedOnly = false,
  modelSelectionLocked = false,
  slotName,
}: ProviderFormProps) {
  const { t } = useTranslation();
  const isCustom = state.selected === CUSTOM_PROVIDER_ID;
  const provider =
    PROVIDERS.find((p) => p.id === state.selected) ?? PROVIDERS[0];
  const modelOptions = modelOptionsForProvider(presets, state.selected);
  const managedOptions = managedModelOptions(managedCatalog, slotName);
  const defaultManagedOption = preferredManagedModelOption(managedOptions);
  const selectedManagedOption =
    managedOptions.find((option) => option.ref === state.managedModelRef) ??
    defaultManagedOption;
  const effectiveSource: ModelSource = managedOnly
    ? "managed"
    : state.modelSource;
  const managedReady = managedFormIsReady(
    { ...state, modelSource: effectiveSource },
    managedCatalog,
    slotName,
  );
  const showLocalForm = effectiveSource === "local";
  const showManagedForm = effectiveSource === "managed";
  const modelListId = `onboarding-models-${slotName}`;

  const handleProviderSelect = (providerId: string) => {
    const existing = getProviderKeys();
    clearCachedPing(slotName);
    onChange({
      ...state,
      modelSource: "local",
      selected: providerId,
      apiKey:
        providerId === CUSTOM_PROVIDER_ID ? "" : (existing[providerId] ?? ""),
      keyVisible: false,
      builtInModel:
        providerId === CUSTOM_PROVIDER_ID
          ? state.builtInModel
          : defaultModelForProvider(presets, providerId),
      customBaseUrl:
        providerId === CUSTOM_PROVIDER_ID ? state.customBaseUrl : "",
      customModel: providerId === CUSTOM_PROVIDER_ID ? state.customModel : "",
      customProviderName:
        providerId === CUSTOM_PROVIDER_ID ? state.customProviderName : "",
    });
  };

  const handleModelSourceSelect = (modelSource: ModelSource) => {
    clearCachedPing(slotName);
    const nextRef = defaultManagedOption?.ref ?? state.managedModelRef;
    onChange({
      ...state,
      modelSource,
      managedModelRef:
        modelSource === "managed" ? nextRef : state.managedModelRef,
      apiKey: modelSource === "managed" ? "" : state.apiKey,
    });
  };

  const updateField = <K extends keyof ProviderFormState>(
    key: K,
    value: ProviderFormState[K],
  ) => {
    clearCachedPing(slotName);
    onChange({ ...state, [key]: value });
  };

  return (
    <div className="space-y-4">
      {modelSelectionLocked && managedOnly && (
        <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Cloud
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-foreground">
              {t(
                "onboarding.modelsManagedByAdmin",
                "Models are managed by your administrator.",
              )}
            </p>
            <p className="leading-relaxed">
              {managedModelsLoading
                ? t(
                    "onboarding.loadingManagedModels",
                    "Loading account models…",
                  )
                : managedOptions.length > 0
                  ? t("onboarding.managedModelAssigned", {
                      model: `${selectedManagedOption?.channelName ?? ""} · ${selectedManagedOption?.name ?? ""}`,
                      defaultValue: "Active model: {{model}}",
                    })
                  : t(
                      "onboarding.noManagedModels",
                      "No usable account models are available yet. Refresh your FrostFox account and try again.",
                    )}
            </p>
          </div>
        </div>
      )}
      {managedOptions.length > 0 && !managedOnly && !modelSelectionLocked && (
        <div className="space-y-2">
          <Label className="ui-eyebrow text-[10px]">
            {t("onboarding.modelSource", "Model source")}
          </Label>
          <div
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t("onboarding.modelSource", "Model source")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={state.modelSource === "managed"}
              onClick={() => handleModelSourceSelect("managed")}
              className={`flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                state.modelSource === "managed"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              <Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("onboarding.managedModels", "FrostFox account models")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={state.modelSource === "local"}
              onClick={() => handleModelSourceSelect("local")}
              className={`flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                state.modelSource === "local"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("onboarding.localProvider", "Local provider key")}
            </button>
          </div>
        </div>
      )}

      {managedOnly && !modelSelectionLocked && managedOptions.length === 0 && (
        <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          {managedModelsLoading ? (
            <span
              className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
              aria-hidden="true"
            />
          ) : (
            <Cloud
              className="h-3.5 w-3.5 shrink-0 text-amber-500"
              aria-hidden="true"
            />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <span className="block">
              {managedModelsLoading
                ? t(
                    "onboarding.loadingManagedModels",
                    "Loading account models…",
                  )
                : t(
                    "onboarding.noManagedModels",
                    "No usable account models are available yet. Refresh your FrostFox account and try again.",
                  )}
            </span>
            {!managedModelsLoading && onRefreshManagedModels && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-[11px]"
                onClick={() => void onRefreshManagedModels()}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {t("onboarding.refreshManagedModels", "Refresh models")}
              </Button>
            )}
          </div>
        </div>
      )}

      {showManagedForm &&
        !modelSelectionLocked &&
        managedOptions.length > 0 && (
          <div className="space-y-1.5">
            <Label
              htmlFor={`onboarding-managed-model-${slotName}`}
              className="ui-eyebrow text-[10px]"
            >
              {t("onboarding.accountModel", "Account model")}
            </Label>
            <select
              id={`onboarding-managed-model-${slotName}`}
              value={state.managedModelRef || defaultManagedOption?.ref || ""}
              onChange={(event) =>
                updateField("managedModelRef", event.target.value)
              }
              className="ui-input-shell min-h-11 w-full border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            >
              {managedOptions.map((option) => (
                <option key={option.ref} value={option.ref}>
                  {option.channelName} · {option.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "onboarding.managedModelHint",
                "Uses your FrostFox account balance. No provider key is required.",
              )}
            </p>
            {managedReady && (
              <div className="flex items-center gap-2">
                <PingButton
                  target={{ kind: "slot", slotId: slotName }}
                  onBeforePing={onBeforePing}
                />
              </div>
            )}
          </div>
        )}
      {showLocalForm && !modelSelectionLocked && (
        <>
          <div className="space-y-2">
            <Label className="ui-eyebrow text-[10px]">
              {t("onboarding.selectProvider", "Provider")}
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderSelect(p.id)}
                  className={`min-h-11 rounded-[var(--radius-control)] border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    state.selected === p.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleProviderSelect(CUSTOM_PROVIDER_ID)}
                className={`col-span-2 min-h-11 rounded-[var(--radius-control)] border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  isCustom
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {t("onboarding.customProvider", "Custom (OpenAI Compatible)")}
              </button>
            </div>
          </div>

          {!isCustom && (
            <div className="space-y-1.5">
              <Label
                htmlFor={`onboarding-local-model-${slotName}`}
                className="ui-eyebrow text-[10px]"
              >
                {t("onboarding.modelId", "Model ID")}
              </Label>
              <input
                id={`onboarding-local-model-${slotName}`}
                type="text"
                list={modelOptions.length > 0 ? modelListId : undefined}
                placeholder="deepseek-chat / gpt-4o / claude-sonnet-4-20250514"
                value={state.builtInModel}
                onChange={(event) =>
                  updateField("builtInModel", event.target.value)
                }
                className="ui-input-shell min-h-11 w-full border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              {modelOptions.length > 0 && (
                <>
                  <datalist id={modelListId}>
                    {modelOptions.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                  <p className="text-[10px] text-muted-foreground">
                    {t(
                      "onboarding.modelIdHint",
                      "Pick one of the detected models or type a model ID directly.",
                    )}
                  </p>
                </>
              )}
            </div>
          )}

          {isCustom && (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor={`onboarding-base-url-${slotName}`}
                  className="ui-eyebrow text-[10px]"
                >
                  {t("onboarding.baseUrl", "Base URL")}
                </Label>
                <input
                  id={`onboarding-base-url-${slotName}`}
                  type="text"
                  placeholder="https://api.example.com/v1"
                  value={state.customBaseUrl}
                  onChange={(event) =>
                    updateField("customBaseUrl", event.target.value)
                  }
                  className="ui-input-shell min-h-11 w-full border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`onboarding-provider-name-${slotName}`}
                    className="ui-eyebrow text-[10px]"
                  >
                    {t("onboarding.providerName", "Provider Name")}
                  </Label>
                  <input
                    id={`onboarding-provider-name-${slotName}`}
                    type="text"
                    placeholder="my-provider"
                    value={state.customProviderName}
                    onChange={(event) =>
                      updateField("customProviderName", event.target.value)
                    }
                    className="ui-input-shell min-h-11 w-full border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`onboarding-custom-model-${slotName}`}
                    className="ui-eyebrow text-[10px]"
                  >
                    {t("onboarding.modelId", "Model ID")}
                  </Label>
                  <input
                    id={`onboarding-custom-model-${slotName}`}
                    type="text"
                    placeholder="gpt-4o / deepseek-chat"
                    value={state.customModel}
                    onChange={(event) =>
                      updateField("customModel", event.target.value)
                    }
                    className="ui-input-shell min-h-11 w-full border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label
              htmlFor={`onboarding-api-key-${slotName}`}
              className="ui-eyebrow text-[10px]"
            >
              {t("onboarding.apiKey", "API Key")}
            </Label>
            <div className="flex gap-1">
              <input
                id={`onboarding-api-key-${slotName}`}
                type={state.keyVisible ? "text" : "password"}
                placeholder={isCustom ? "sk-..." : provider.placeholder}
                value={state.apiKey}
                onChange={(event) => updateField("apiKey", event.target.value)}
                className="ui-input-shell min-h-11 min-w-0 flex-1 border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() =>
                  onChange({ ...state, keyVisible: !state.keyVisible })
                }
                aria-label={t(
                  state.keyVisible
                    ? "onboarding.hideApiKey"
                    : "onboarding.showApiKey",
                  state.keyVisible ? "Hide API key" : "Show API key",
                )}
                className="min-h-11 min-w-11 shrink-0"
              >
                {state.keyVisible ? (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </Button>
            </div>
            {!isCustom && (
              <div className="font-mono text-[10px] text-muted-foreground">
                {provider.keyEnv}
              </div>
            )}
          </div>

          {state.apiKey.trim() && (
            <div className="flex items-center gap-2">
              <PingButton
                target={{ kind: "slot", slotId: slotName }}
                onBeforePing={onBeforePing}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
