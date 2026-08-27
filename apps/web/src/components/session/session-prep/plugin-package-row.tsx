import { useEffect, useState } from "react";
import { Cpu, KeyRound, Lock, Wrench } from "lucide-react";
import { FrameworkCapability, FrameworkRuntimeCapability } from "@covel/shared";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.js";
import { text } from "@/components/world/editor-helpers.js";
import { stageLabel } from "@/lib/stage-label.js";
import type { ResolvedSlot } from "@/hooks/use-slot-config.js";
import { formatSlotLabel } from "@/hooks/use-slot-config.js";
import type { UseRuntimeBindingsResult } from "@/hooks/use-runtime-bindings.js";
import {
  recommendationReason,
  type PluginPack,
} from "@/lib/session-plugin-selection.js";
import {
  frostFoxModelControlsLocked,
  useFrostFoxAccountOptional,
} from "@/components/frostfox-account-context.js";
import { getSettings } from "@/settings/store.js";
import { resolveProviderSlot } from "./model-slot-helpers.js";
import type * as api from "@/services/api.js";

export interface PluginPackageRowProps {
  pkg: api.PackageSummary;
  world: api.WorldRecord;
  activePluginPack: PluginPack | null;
  selectedPluginIdSet: ReadonlySet<string>;
  corePluginIds: ReadonlySet<string>;
  lockedPluginIds: ReadonlySet<string>;
  bindingState: UseRuntimeBindingsResult;
  resolvedSlots: ResolvedSlot[];
  resolveDeclaredSlot: (slotId: string) => ResolvedSlot | null;
  /** Hosted non-admin players use the administrator's model policy. */
  modelControlsLocked?: boolean;
  onTogglePlugin: (name: string) => void;
}

export function PluginPackageRow({
  pkg,
  world,
  activePluginPack,
  selectedPluginIdSet,
  corePluginIds,
  lockedPluginIds,
  bindingState,
  resolvedSlots,
  resolveDeclaredSlot,
  modelControlsLocked,
  onTogglePlugin,
}: PluginPackageRowProps) {
  const { t, i18n } = useTranslation();
  const frostFoxAccount = useFrostFoxAccountOptional();
  const hostedPlayerModelLocked =
    modelControlsLocked ?? frostFoxModelControlsLocked(frostFoxAccount?.status);
  const displayName = text(pkg.displayName) || pkg.name;
  const description = text(pkg.description);
  const isSelected = selectedPluginIdSet.has(pkg.name);
  const isLocked = lockedPluginIds.has(pkg.name);
  const isCore = corePluginIds.has(pkg.name);
  const reason = recommendationReason(pkg, world, activePluginPack, {
    locale: i18n.language,
    requiredByWorld: t(
      "session.recommendationReasons.requiredByWorld",
      "Required by world",
    ),
    packOptional: t(
      "session.recommendationReasons.packOptional",
      "Pack optional",
    ),
    recommendedByWorld: t(
      "session.recommendationReasons.recommendedByWorld",
      "Recommended by world",
    ),
  });
  const runtimes = pkg.runtimes ?? [];
  const tools = pkg.tools ?? [];
  const pluginBindings = bindingState.entries.filter(
    (entry) => entry.pluginId === pkg.name,
  );
  const primaryBinding = pluginBindings[0];
  const hasAgentRuntime = pluginBindings.length > 0;
  const isTextSlot = (slot: ResolvedSlot): boolean =>
    slot.tag === "text" || slot.tag === undefined;
  const isMissingTextRuntimeSlot = (slotId: string): boolean => {
    const direct = resolvedSlots.find((slot) => slot.slotId === slotId);
    if (direct) return !isTextSlot(direct);
    return resolveDeclaredSlot(slotId) === null;
  };
  const primaryBindingSlots = primaryBinding
    ? bindingState.compatibleSlots(primaryBinding.defaultSlot)
    : [];
  const providerSlotSetting = pkg.userSettings?.find(
    (spec) => spec.type === "slot",
  );
  const manifestDefaultSlot =
    typeof providerSlotSetting?.default === "string"
      ? providerSlotSetting.default
      : undefined;
  const providerSlotTag = pkg.runtimes?.some(
    (runtime) =>
      runtime.capabilities?.includes(
        FrameworkRuntimeCapability.ImageGenerator,
      ) || runtime.capabilities?.includes(FrameworkCapability.ImageGeneration),
  )
    ? "image"
    : (resolvedSlots.find((slot) => slot.slotId === manifestDefaultSlot)?.tag ??
      "text");
  const providerSlots = resolvedSlots.filter((slot) =>
    providerSlotTag === "text"
      ? slot.tag === "text" || slot.tag === undefined
      : slot.tag === providerSlotTag,
  );
  const providerSlotKey = `plugin.${pkg.name}.${providerSlotSetting?.key ?? ""}`;
  const [providerSlotOverride, setProviderSlotOverride] = useState<
    string | undefined
  >(() => {
    const store = getSettings();
    return store.has(providerSlotKey)
      ? store.get<string>(providerSlotKey)
      : undefined;
  });

  useEffect(() => {
    const store = getSettings();
    const read = () =>
      store.has(providerSlotKey)
        ? store.get<string>(providerSlotKey)
        : undefined;
    setProviderSlotOverride(read());
    return store.subscribe<string>(providerSlotKey, () => {
      setProviderSlotOverride(read());
    });
  }, [providerSlotKey]);

  const {
    effectiveSlot: effectiveProviderSlot,
    missing: providerSlotMissing,
    isOverridden: providerSlotOverridden,
  } = resolveProviderSlot({
    manifestDefault: manifestDefaultSlot,
    override: providerSlotOverride,
    isMissing: (slotId) =>
      !resolvedSlots.some(
        (slot) =>
          slot.slotId === slotId &&
          (providerSlotTag === "text"
            ? slot.tag === "text" || slot.tag === undefined
            : slot.tag === providerSlotTag),
      ),
  });

  const handleProviderSlotChange = (value: string): void => {
    const store = getSettings();
    if (value === "") {
      void store.clear(providerSlotKey);
      setProviderSlotOverride(undefined);
      return;
    }
    void store.set(providerSlotKey, value);
    setProviderSlotOverride(value);
  };

  const hasMissingRuntimeSlot = pluginBindings.some((binding) =>
    isMissingTextRuntimeSlot(binding.defaultSlot),
  );

  return (
    <div
      data-testid={`plugin-row-${pkg.name}`}
      className={`min-w-0 rounded-2xl border p-3 transition-all duration-200 sm:p-4 ${
        isSelected
          ? "border-primary/40 bg-card/85 shadow-xs"
          : "border-border/60 bg-muted/20 opacity-75 hover:bg-muted/35 hover:opacity-100"
      }`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
        <button
          type="button"
          role="switch"
          aria-checked={isSelected}
          disabled={isLocked}
          onClick={() => onTogglePlugin(pkg.name)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
            isSelected ? "bg-primary" : "bg-muted-foreground/30"
          } ${isLocked ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${
              isSelected ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>

        <span className="min-w-0 max-w-full flex-1 truncate text-xs font-semibold text-foreground sm:flex-none sm:text-sm">
          {displayName}
        </span>

        {isLocked && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            title={
              isCore
                ? t("plugin.locked", "Core plugin — cannot be disabled")
                : t("session.world", "World")
            }
          >
            <Lock className="h-2.5 w-2.5" />
            <span>
              {isCore ? t("plugin.core", "Core") : t("session.world", "World")}
            </span>
          </span>
        )}

        {runtimes[0]?.stage && (
          <Badge variant="outline" className="shrink-0 font-mono text-[9px]">
            {stageLabel(runtimes[0].stage, t)}
          </Badge>
        )}
        {runtimes[0]?.kind && (
          <Badge variant="secondary" className="shrink-0 font-mono text-[9px]">
            {runtimes[0].kind === "agent" ? "LLM" : "Fn"}
          </Badge>
        )}
        {tools.length > 0 && (
          <span className="flex shrink-0 items-center gap-0.5 font-mono text-[9px] text-muted-foreground">
            <Wrench className="h-2.5 w-2.5" />
            {tools.length}
          </span>
        )}
        {hostedPlayerModelLocked && (
          <Badge
            variant="outline"
            className="flex shrink-0 items-center gap-1 border-primary/30 text-[9px] text-primary"
          >
            <Lock className="h-2.5 w-2.5" />
            {t("plugin.modelManagedByAdmin", "model managed")}
          </Badge>
        )}

        {hasAgentRuntime &&
          isSelected &&
          primaryBinding &&
          pluginBindings.length === 1 &&
          !hasMissingRuntimeSlot &&
          primaryBindingSlots.length > 1 &&
          !hostedPlayerModelLocked && (
            <select
              value={primaryBinding.slotName}
              onChange={(event) =>
                bindingState.setBinding(
                  primaryBinding.qualifiedId,
                  event.target.value,
                )
              }
              className="order-last min-w-0 basis-full rounded-xl border border-border/80 bg-background/80 px-2.5 py-1 text-[11px] outline-none sm:order-none sm:ml-auto sm:w-auto sm:basis-auto sm:max-w-[240px]"
              aria-label={t(
                "plugin.modelBindingAria",
                "Which model slot this plugin's runtime will use.",
              )}
            >
              <option value="">
                {(() => {
                  const declared = primaryBinding.defaultSlot;
                  const defaultSlot = resolveDeclaredSlot(declared);
                  const label = formatSlotLabel(defaultSlot);
                  if (label) {
                    return t("plugin.useRuntimeDefaultWith", {
                      slot: declared,
                      value: label,
                      defaultValue: `Runtime default: ${declared} (${label})`,
                    });
                  }
                  return t("plugin.useRuntimeDefault", {
                    slot: declared,
                    defaultValue: `Runtime default: ${declared}`,
                  });
                })()}
              </option>
              {primaryBindingSlots.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>
                  {slot.slotId}
                  {slot.serverModel ? ` · ${slot.serverModel}` : ""}
                </option>
              ))}
            </select>
          )}
      </div>

      {description && (
        <p className="text-[11px] sm:text-xs text-muted-foreground mt-2 pl-1 sm:pl-9 line-clamp-2 leading-relaxed">
          {description}
        </p>
      )}

      {/* Tags and Reasons */}
      <div className="mt-2 pl-1 sm:pl-9 flex flex-wrap gap-1">
        {reason && (
          <Badge variant="flat" className="text-[9px] px-2 py-0 h-4">
            {reason}
          </Badge>
        )}
        {(pkg.tags ?? []).slice(0, 4).map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className="text-[9px] px-1.5 py-0 h-4 text-muted-foreground font-mono"
          >
            {tag}
          </Badge>
        ))}
      </div>

      {/* Provider Slot Config */}
      {isSelected && providerSlotSetting && !hostedPlayerModelLocked && (
        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2 pl-1 text-[11px] text-muted-foreground sm:pl-9">
          <KeyRound className="h-3 w-3 shrink-0" />
          <span className="min-w-0 max-w-full truncate font-mono text-[10px]">
            {pkg.name}
          </span>
          <Badge
            variant={providerSlotMissing ? "destructive" : "outline"}
            className="shrink-0 px-1.5 py-0.2 font-mono text-[9px]"
          >
            {providerSlotMissing
              ? t("plugin.slotMissingShort", {
                  slot: effectiveProviderSlot,
                  defaultValue: `missing [covel.${effectiveProviderSlot}]`,
                })
              : providerSlotOverridden
                ? `override: ${effectiveProviderSlot}`
                : `default: ${effectiveProviderSlot}`}
          </Badge>
          {providerSlots.length > 0 && (
            <select
              value={
                providerSlots.some(
                  (slot) => slot.slotId === providerSlotOverride,
                )
                  ? providerSlotOverride
                  : ""
              }
              onChange={(event) => handleProviderSlotChange(event.target.value)}
              className="w-full min-w-0 max-w-full rounded-xl border border-border/80 bg-background/80 px-2.5 py-1 text-[11px] outline-none sm:ml-auto sm:w-auto sm:max-w-[240px]"
            >
              <option value="">
                {manifestDefaultSlot
                  ? t("plugin.providerSlotDefaultOption", {
                      slot: manifestDefaultSlot,
                      defaultValue: `default · [covel.${manifestDefaultSlot}]`,
                    })
                  : t("plugin.providerSlotNoDefault", "default")}
              </option>
              {providerSlots.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>
                  {slot.slotId}
                  {slot.serverModel ? ` · ${slot.serverModel}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {isSelected && providerSlotSetting && hostedPlayerModelLocked && (
        <div className="mt-2.5 flex min-w-0 items-center gap-2 pl-1 text-[11px] text-muted-foreground sm:pl-9">
          <Lock className="h-3 w-3 shrink-0 text-primary" />
          <span>{t("plugin.modelManagedByAdmin", "Model managed")}</span>
        </div>
      )}

      {isSelected &&
        !hostedPlayerModelLocked &&
        pluginBindings.length > 0 &&
        (pluginBindings.length > 1 || hasMissingRuntimeSlot) && (
          <div className="mt-2.5 space-y-2 pl-1 sm:pl-9">
            {pluginBindings.map((binding) => {
              const declaredSlot = binding.defaultSlot;
              const configuredDefault = isMissingTextRuntimeSlot(declaredSlot)
                ? null
                : resolveDeclaredSlot(declaredSlot);
              const missingDefault = isMissingTextRuntimeSlot(declaredSlot);
              const bindingSlots = bindingState.compatibleSlots(declaredSlot);
              const showPicker =
                pluginBindings.length > 1 ||
                missingDefault ||
                bindingSlots.length > 1;
              return (
                <div
                  key={binding.qualifiedId}
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
                >
                  <Cpu className="h-3 w-3 shrink-0" />
                  <span
                    className="min-w-0 max-w-full truncate font-mono text-[10px] sm:max-w-[200px]"
                    title={binding.qualifiedId}
                  >
                    {binding.qualifiedId}
                  </span>
                  <Badge
                    variant={missingDefault ? "destructive" : "outline"}
                    className="shrink-0 px-1.5 py-0.2 font-mono text-[9px]"
                  >
                    {missingDefault
                      ? `missing [${declaredSlot}]`
                      : `default: ${declaredSlot}`}
                  </Badge>
                  {showPicker && (
                    <select
                      value={binding.slotName}
                      onChange={(event) =>
                        bindingState.setBinding(
                          binding.qualifiedId,
                          event.target.value,
                        )
                      }
                      className="w-full min-w-0 max-w-full rounded-xl border border-border/80 bg-background/80 px-2.5 py-1 text-[11px] outline-none sm:ml-auto sm:w-auto sm:max-w-[240px]"
                    >
                      <option value="">
                        {configuredDefault
                          ? `default · ${declaredSlot}`
                          : `(unassigned)`}
                      </option>
                      {bindingSlots.map((slot) => (
                        <option key={slot.slotId} value={slot.slotId}>
                          {slot.slotId}
                          {slot.serverModel ? ` · ${slot.serverModel}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
