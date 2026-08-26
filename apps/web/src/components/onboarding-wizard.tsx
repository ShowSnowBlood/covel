import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { FrostFoxModelCatalog, PresetSummary } from "@/services/api.js";
import {
  listPresets,
  managedCatalogToPresetSummaries,
} from "@/services/api.js";
import { useFrostFoxAccount } from "@/components/frostfox-account-summary.js";
import { useLocalePreference } from "@/hooks/useLocalePreference";
import { TOTAL_STEPS } from "./onboarding-wizard/constants.js";
import {
  CloseButton,
  LocaleToggle,
  StepIndicator,
} from "./onboarding-wizard/chrome.js";
import {
  bindPluginSlotToStory,
  isOnboarded,
  markOnboarded,
  persistPluginModeSame,
  persistSlot,
} from "./onboarding-wizard/persistence.js";
import {
  defaultModelForProvider,
  defaultManagedFormState,
  managedModelOptions,
  emptyFormState,
} from "./onboarding-wizard/provider-state.js";
import {
  isPluginContinueDisabled,
  isStoryContinueDisabled,
  PluginStep,
  ReadyStep,
  StoryStep,
  summarizeStoryProvider,
  WelcomeStep,
} from "./onboarding-wizard/steps.js";
import type {
  OnboardingStep,
  PluginMode,
  ProviderFormState,
} from "./onboarding-wizard/types.js";

export { resetOnboarding } from "./onboarding-wizard/persistence.js";

function nextStep(step: OnboardingStep): OnboardingStep {
  return Math.min(step + 1, TOTAL_STEPS - 1) as OnboardingStep;
}

function previousStep(step: OnboardingStep): OnboardingStep {
  return Math.max(step - 1, 0) as OnboardingStep;
}

function useAvailablePresets(
  managedCatalog: FrostFoxModelCatalog | null,
): PresetSummary[] {
  const [localPresets, setLocalPresets] = useState<PresetSummary[]>([]);

  useEffect(() => {
    let alive = true;
    void listPresets()
      .then((presets) => {
        if (alive) setLocalPresets(presets.filter((preset) => preset.enabled));
      })
      .catch(() => {
        if (alive) setLocalPresets([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => {
    const managed = managedCatalogToPresetSummaries(managedCatalog);
    const managedIds = new Set(managed.map((preset) => preset.id));
    return [
      ...localPresets.filter((preset) => !managedIds.has(preset.id)),
      ...managed,
    ];
  }, [localPresets, managedCatalog]);
}

function useDefaultModelSelection(
  form: ProviderFormState,
  setForm: Dispatch<SetStateAction<ProviderFormState>>,
  availablePresets: PresetSummary[],
  managedCatalog: FrostFoxModelCatalog | null,
  managedOnly: boolean,
  slotName: "story" | "plugin",
): void {
  useEffect(() => {
    if (managedOnly) {
      const managedOption = managedModelOptions(managedCatalog, slotName)[0];
      if (!managedOption) return;
      setForm((current) =>
        current.modelSource === "managed" && current.managedModelRef
          ? current
          : defaultManagedFormState(
              { ...current, modelSource: "managed" },
              managedCatalog,
              slotName,
            ),
      );
      return;
    }

    if (
      form.modelSource === "managed" ||
      form.selected === "__custom__" ||
      form.builtInModel.trim()
    ) {
      return;
    }

    const nextModel = defaultModelForProvider(availablePresets, form.selected);
    if (!nextModel) return;

    setForm((current) =>
      current.modelSource === "managed" ||
      current.selected === "__custom__" ||
      current.builtInModel.trim()
        ? current
        : { ...current, builtInModel: nextModel },
    );
  }, [
    availablePresets,
    form.builtInModel,
    form.managedModelRef,
    form.modelSource,
    form.selected,
    managedCatalog,
    managedOnly,
    setForm,
    slotName,
  ]);
}

export function OnboardingWizard() {
  const [visible, setVisible] = useState(() => !isOnboarded());
  const { locale, setLocale } = useLocalePreference();
  const { status, catalog: managedCatalog, loading: managedLoading } =
    useFrostFoxAccount();
  const managedOnly = Boolean(status?.enabled && status.authenticated);
  const managedModelsLoading = managedOnly && managedLoading;
  const [step, setStep] = useState<OnboardingStep>(0);
  const availablePresets = useAvailablePresets(managedCatalog);

  const [storyForm, setStoryForm] = useState<ProviderFormState>(() =>
    emptyFormState(),
  );
  const [pluginMode, setPluginMode] = useState<PluginMode>("same");
  const [pluginForm, setPluginForm] = useState<ProviderFormState>(() =>
    emptyFormState(),
  );

  useDefaultModelSelection(
    storyForm,
    setStoryForm,
    availablePresets,
    managedCatalog,
    managedOnly,
    "story",
  );
  useDefaultModelSelection(
    pluginForm,
    setPluginForm,
    availablePresets,
    managedCatalog,
    managedOnly,
    "plugin",
  );

  const dismiss = useCallback(() => {
    markOnboarded();
    setVisible(false);
  }, []);

  const handleNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      setStep((current) => nextStep(current));
      return;
    }
    dismiss();
  }, [step, dismiss]);

  const handleBack = useCallback(() => {
    setStep((current) => previousStep(current));
  }, []);

  const handleBeforePingStory = useCallback(async () => {
    await persistSlot(storyForm, "story", availablePresets);
  }, [storyForm, availablePresets]);

  const handleBeforePingPlugin = useCallback(async () => {
    await persistSlot(pluginForm, "plugin", availablePresets);
  }, [pluginForm, availablePresets]);

  const handleContinueFromStory = useCallback(async () => {
    await persistSlot(storyForm, "story", availablePresets);
    bindPluginSlotToStory();
    setStep((current) => nextStep(current));
  }, [storyForm, availablePresets]);

  const handleContinueFromPlugin = useCallback(async () => {
    if (
      pluginMode === "different" &&
      (pluginForm.modelSource === "managed" || pluginForm.apiKey.trim())
    ) {
      await persistSlot(pluginForm, "plugin", availablePresets);
    } else {
      persistPluginModeSame();
    }
    setStep((current) => nextStep(current));
  }, [pluginForm, pluginMode, availablePresets]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm">
      <LocaleToggle locale={locale} setLocale={setLocale} />
      <CloseButton onDismiss={dismiss} />

      <div className="relative w-full max-w-md max-h-full flex flex-col min-h-0">
        <StepIndicator step={step} />

        <div className="ui-dialog-shell border border-border p-5 sm:p-8 overflow-y-auto min-h-0">
          {step === 0 && (
            <WelcomeStep
              locale={locale}
              setLocale={setLocale}
              onNext={handleNext}
            />
          )}

          {step === 1 && (
            <StoryStep
              storyForm={storyForm}
              setStoryForm={setStoryForm}
              availablePresets={availablePresets}
              managedCatalog={managedCatalog}
              managedModelsLoading={managedModelsLoading}
              managedOnly={managedOnly}
              storyContinueDisabled={isStoryContinueDisabled(
                storyForm,
                managedCatalog,
              )}
              onBeforePingStory={handleBeforePingStory}
              onContinue={handleContinueFromStory}
              onSkip={handleNext}
            />
          )}

          {step === 2 && (
            <PluginStep
              storySummary={summarizeStoryProvider(storyForm, managedCatalog)}
              pluginMode={pluginMode}
              setPluginMode={setPluginMode}
              pluginForm={pluginForm}
              setPluginForm={setPluginForm}
              availablePresets={availablePresets}
              managedCatalog={managedCatalog}
              managedModelsLoading={managedModelsLoading}
              managedOnly={managedOnly}
              pluginContinueDisabled={isPluginContinueDisabled(
                pluginMode,
                pluginForm,
                managedCatalog,
              )}
              onBeforePingPlugin={handleBeforePingPlugin}
              onBack={handleBack}
              onContinue={handleContinueFromPlugin}
            />
          )}

          {step === 3 && <ReadyStep onDismiss={dismiss} />}
        </div>
      </div>
    </div>
  );
}
