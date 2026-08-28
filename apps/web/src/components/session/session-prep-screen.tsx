import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  ArrowLeft,
  Loader2,
  Puzzle,
  Cpu,
  History,
  FileText,
  KeyRound,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import * as api from "@/services/api.js";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { SettingsDialog } from "@/settings/SettingsDialog.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog.js";
import { text } from "@/components/world/editor-helpers.js";
import { useSlotConfig } from "@/hooks/use-slot-config.js";
import { resolveDeclaredSlot } from "./session-prep/model-slot-helpers.js";
import {
  activeSessionRecords,
  removeSessionById,
  startPluginsPayload,
} from "./session-prep/session-actions.js";
import { SessionHistoryCard } from "./session-prep/session-history-card.js";
import { DimensionActions } from "./session-prep/dimension-actions.js";
import {
  defaultSelectedPluginIdsForWorld,
  isLockedCorePackage,
} from "./session-prep/plugin-selection-helpers.js";
import { ShinyText, Magnet, StarBorder } from "@/components/reactbits/index.js";
import {
  frostFoxModelControlsLocked,
  frostFoxSettingsAvailable,
  useFrostFoxAccountOptional,
} from "@/components/frostfox-account-context.js";
import { isDesktopApp } from "@/lib/desktop-bridge.js";
import { SceneLoadingTransition } from "@/components/visual-effects/SceneLoadingTransition.js";
import { cn } from "@/lib/utils.js";
import { ignoreError } from "@/lib/ignore-error.js";
import type { SessionPrepScreenProps } from "./session-prep/types.js";
import { worldVisual } from "@/lib/world-visuals.js";
import { usePluginSelection } from "./session-prep/use-plugin-selection.js";
import { useWorldDataPreflight } from "./session-prep/use-world-data-preflight.js";
import { usePrepRuntimeBindings } from "./session-prep/use-prep-runtime-bindings.js";
import { PluginSelectionCard } from "./session-prep/plugin-selection-card.js";
import { ActiveModelSlots } from "./active-model-slots.js";

export { defaultSelectedPluginIdsForWorld, isLockedCorePackage };

type CockpitTab = "plugins" | "models" | "history";

/**
 * SessionPrepScreen — Single-Screen Cockpit Dashboard
 * Completely eliminates vertical page scroll.
 * Left: 4K World Hero Poster + World Lore/Dimensions Card (40%)
 * Right: Cockpit Control Panel with Plugins, Models, History tabs & HeroUI CTA (60%)
 */
export function SessionPrepScreen({
  world,
  packages,
  presets,
  llmConfig,
  onBack,
  onStart,
  onResume,
  onDeleteSession,
  settingsOpen,
  onSettingsOpenChange,
  settingsInitialKey,
}: SessionPrepScreenProps) {
  const { t } = useTranslation();
  const frostFoxAccount = useFrostFoxAccountOptional();
  const modelControlsLocked = frostFoxModelControlsLocked(
    frostFoxAccount?.status,
  );
  const settingsAvailable = frostFoxSettingsAvailable(
    frostFoxAccount?.status,
    isDesktopApp(),
  );
  const { resolvedSlots, refresh: refreshSlots } = useSlotConfig(
    presets,
    llmConfig,
  );

  const {
    corePluginIds,
    lockedPluginIds,
    selectedPackages,
    selectedPluginIds,
    selectedPluginIdSet,
    pluginPacks,
    activePluginPack,
    pluginSearch,
    activePluginTags,
    availablePluginTags,
    pluginGroups,
    setPluginSearch,
    togglePluginTag,
    applyPack,
    togglePlugin,
  } = usePluginSelection(world, packages);

  const {
    worldDataPreflight,
    worldDataPreflightStatus,
    worldDataPreflightError,
    runWorldDataPreflight,
  } = useWorldDataPreflight(world.id, selectedPluginIds);

  const { bindingState } = usePrepRuntimeBindings(
    world.id,
    selectedPackages,
    resolvedSlots,
  );

  const [flowData, setFlowData] = useState<api.PluginFlowResponse | null>(null);
  useEffect(() => {
    api
      .fetchPluginFlows()
      .then(setFlowData)
      .catch(ignoreError("fetch plugin flows"));
  }, []);

  const [activeTab, setActiveTab] = useState<CockpitTab>("plugins");
  const [existingSessions, setExistingSessions] = useState<api.SessionRecord[]>(
    [],
  );
  const [deleteTarget, setDeleteTarget] = useState<api.SessionRecord | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .listSessions(world.id)
      .then(setExistingSessions)
      .catch(ignoreError("list existing sessions"));
  }, [world.id]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDeleteSession(deleteTarget.id);
      setExistingSessions((prev) => removeSessionById(prev, deleteTarget.id));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDeleteSession]);

  const [loreValue, setLoreValue] = useState<string>(text(world.lore));
  const originalLore = text(world.lore);
  const isLoreModified = loreValue !== originalLore;

  useEffect(() => {
    api.getWorldOverlay(world.id).then((overlay) => {
      if (overlay?.lore) setLoreValue(overlay.lore);
    });
  }, [world.id]);

  const handleLoreChange = useCallback(
    (value: string) => {
      setLoreValue(value);
      if (value !== originalLore) {
        void api.setWorldOverlay(world.id, {
          lore: value,
          updatedAt: new Date().toISOString(),
        });
      } else {
        void api.removeWorldOverlay(world.id);
      }
    },
    [originalLore, world.id],
  );

  const resetLore = useCallback(() => {
    setLoreValue(originalLore);
    void api.removeWorldOverlay(world.id);
  }, [originalLore, world.id]);

  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      onSettingsOpenChange(open);
      if (!open) refreshSlots();
    },
    [onSettingsOpenChange, refreshSlots],
  );

  const activeSessions = useMemo(
    () => activeSessionRecords(existingSessions),
    [existingSessions],
  );
  const visual = useMemo(() => worldVisual(world), [world]);
  const selectedFlowSteps = useMemo(() => {
    if (!flowData) return [];
    return flowData.steps.filter((step) =>
      selectedPluginIdSet.has(step.pluginId),
    );
  }, [flowData, selectedPluginIdSet]);

  const resolveSelectedDeclaredSlot = useCallback(
    (slotId: string) => resolveDeclaredSlot(resolvedSlots, slotId),
    [resolvedSlots],
  );

  const [isStarting, setIsStarting] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [isBacking, setIsBacking] = useState(false);

  const handleBack = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onBack();
      return;
    }
    setIsBacking(true);
  }, [onBack]);

  const handleStart = useCallback(async () => {
    if (isStarting) return;
    setIsStarting(true);
    try {
      await onStart(startPluginsPayload(selectedPluginIds));
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, selectedPluginIds, onStart]);

  const handleResume = useCallback(
    async (session: api.SessionRecord) => {
      if (resumingId) return;
      setResumingId(session.id);
      try {
        await onResume(session);
      } finally {
        setResumingId(null);
      }
    },
    [resumingId, onResume],
  );

  return (
    <div className="h-full w-full overflow-hidden bg-background text-foreground flex flex-col">
      {settingsAvailable && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={handleSettingsOpenChange}
          initialKey={settingsInitialKey}
        />
      )}

      {/* Main Responsive Cockpit Area */}
      <div className="flex-1 w-full max-w-[1700px] mx-auto p-2.5 sm:p-5 md:p-6 lg:p-7 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row gap-3 sm:gap-5 ui-scroll">
        {/* Left Column (40%): 4K World Hero + World Lore / Dimensions */}
        <section className="w-full lg:w-[42%] xl:w-[40%] flex flex-col gap-4 shrink-0 lg:h-full lg:overflow-hidden">
          {/* Card 1: 4K World Cover Poster */}
          <article
            className="relative rounded-2xl sm:rounded-3xl border border-border/80 bg-card shadow-xl overflow-hidden flex flex-col justify-between p-3.5 sm:p-6 shrink-0 min-h-[170px] sm:min-h-[220px] lg:max-h-[48%]"
            style={{ "--world-accent": visual.accent } as CSSProperties}
          >
            {/* 4K/2K Artwork Background */}
            <img
              src={visual.image}
              alt=""
              aria-hidden="true"
              width={3840}
              height={2160}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover scale-[1.02] transition-transform duration-700"
              draggable={false}
            />
            {/* Dark Vignette Overlays */}
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, rgba(9,9,11,0.92) 0%, rgba(9,9,11,0.65) 50%, rgba(9,9,11,0.35) 100%), linear-gradient(180deg, rgba(9,9,11,0.4) 0%, rgba(9,9,11,0.85) 100%)",
              }}
            />

            {/* Header Back Button & Tags */}
            <div className="relative z-10 flex items-center justify-between gap-3 text-white">
              <Button
                variant="bordered"
                size="sm"
                radius="full"
                className="h-8 border-white/20 bg-black/40 px-3.5 text-xs text-white/90 backdrop-blur-md hover:bg-white/20 hover:text-white"
                onClick={handleBack}
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                {t("session.breadcrumbWorldSelect", "Select World")}
              </Button>
              <div className="flex flex-wrap gap-1">
                {(world.tags ?? []).slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/20 bg-black/35 px-2.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-md"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* World Title & Summary */}
            <div className="relative z-10 space-y-2 mt-auto text-white">
              <span className="ui-eyebrow text-[10px] text-white/60 font-mono tracking-widest block">
                {t("session.preparation", "SESSION SETUP")}
              </span>
              <h1 className="ui-title text-xl sm:text-3xl font-bold leading-tight text-white tracking-tight">
                <ShinyText speed={5} shineColor="rgba(255, 255, 255, 0.9)">
                  {text(world.name)}
                </ShinyText>
              </h1>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed line-clamp-3 font-light">
                {text(world.description)}
              </p>
            </div>
          </article>

          {/* Card 2: World Lore & Dimensions */}
          <article className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card/85 backdrop-blur-xl shadow-lg p-3.5 sm:p-5 flex-1 flex flex-col justify-between overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  {t("session.worldDocument", "World Document & Lore")}
                </h3>
              </div>
              {isLoreModified && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 gap-1 text-[10px] text-amber-500 hover:text-amber-400"
                  onClick={resetLore}
                >
                  <RotateCcw className="w-3 h-3" />
                  {t("common.reset", "Reset")}
                </Button>
              )}
            </div>

            {/* Lore Editor / Preview Area */}
            <div className="flex-1 my-3 overflow-hidden rounded-xl border border-border/70 bg-background/50 p-3 backdrop-blur-xs flex flex-col">
              <p className="ui-eyebrow text-[10px] text-muted-foreground mb-1.5 font-mono">
                {loreValue.length.toLocaleString()}{" "}
                {t("common.chars", "characters")} ·{" "}
                {t("session.loreDoc", "Knowledge Base")}
              </p>
              <textarea
                value={loreValue}
                onChange={(e) => handleLoreChange(e.target.value)}
                placeholder={t(
                  "session.lorePlaceholder",
                  "World lore and background setting...",
                )}
                className="w-full flex-1 bg-transparent text-xs leading-relaxed outline-none resize-none ui-scroll text-foreground/90 placeholder:text-muted-foreground"
              />
            </div>

            {/* Dimension Import / Export Actions */}
            <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-3">
              <DimensionActions
                worldId={world.id}
                enabled={Boolean(world.dimensions)}
              />
            </div>
          </article>
        </section>

        {/* Right Column (60%): Cockpit Control Console with Tabs & CTA */}
        <section className="w-full lg:w-[58%] xl:w-[60%] flex flex-col gap-3 min-h-[480px] lg:h-full lg:overflow-hidden flex-1">
          {/* Cockpit Card Shell */}
          <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-card/90 backdrop-blur-2xl shadow-xl sm:shadow-2xl flex-1 flex flex-col overflow-hidden p-3 sm:p-5 md:p-6">
            {/* Cockpit Header with Tab Switches */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/80 pb-3.5 sm:pb-4 shrink-0">
              {/* Tabs */}
              <div className="flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-2xl border border-border/80 bg-background/60 p-1 backdrop-blur-xs sm:w-auto sm:flex-1 ui-scroll">
                <button
                  type="button"
                  title={t("session.plugins", "Gameplay Plugins")}
                  onClick={() => setActiveTab("plugins")}
                  className={cn(
                    "flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1.5 py-1.5 text-[11px] font-semibold transition-all duration-200 cursor-pointer select-none xl:gap-2 xl:px-3.5 xl:text-xs",
                    activeTab === "plugins"
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  <Puzzle className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate xl:hidden">
                    {t("session.pluginsShort", "Plugins")}
                  </span>
                  <span className="hidden min-w-0 truncate xl:inline">
                    {t("session.plugins", "Gameplay Plugins")}
                  </span>
                  <Badge
                    variant={activeTab === "plugins" ? "secondary" : "outline"}
                    className="shrink-0 px-1 py-0 text-[9px] font-mono xl:px-1.5"
                  >
                    {selectedPluginIds.length}/{packages.length}
                  </Badge>
                </button>

                <button
                  type="button"
                  title={t("session.activeModels", "AI Models")}
                  onClick={() => setActiveTab("models")}
                  className={cn(
                    "flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1.5 py-1.5 text-[11px] font-semibold transition-all duration-200 cursor-pointer select-none xl:gap-2 xl:px-3.5 xl:text-xs",
                    activeTab === "models"
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  <Cpu className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate xl:hidden">
                    {t("session.activeModelsShort", "Models")}
                  </span>
                  <span className="hidden min-w-0 truncate xl:inline">
                    {t("session.activeModels", "AI Models")}
                  </span>
                  <Badge
                    variant={activeTab === "models" ? "secondary" : "outline"}
                    className="shrink-0 px-1 py-0 text-[9px] font-mono xl:px-1.5"
                  >
                    {resolvedSlots.length}
                  </Badge>
                </button>

                <button
                  type="button"
                  title={t("session.sessions", "Saved Sessions")}
                  onClick={() => setActiveTab("history")}
                  className={cn(
                    "flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1.5 py-1.5 text-[11px] font-semibold transition-all duration-200 cursor-pointer select-none xl:gap-2 xl:px-3.5 xl:text-xs",
                    activeTab === "history"
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  <History className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate xl:hidden">
                    {t("session.sessionsShort", "Sessions")}
                  </span>
                  <span className="hidden min-w-0 truncate xl:inline">
                    {t("session.sessions", "Saved Sessions")}
                  </span>
                  {activeSessions.length > 0 && (
                    <Badge
                      variant={
                        activeTab === "history" ? "secondary" : "outline"
                      }
                      className="shrink-0 px-1 py-0 text-[9px] font-mono xl:px-1.5"
                    >
                      {activeSessions.length}
                    </Badge>
                  )}
                </button>
              </div>

              {/* Status Indicator */}
              <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] text-muted-foreground font-medium">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  {selectedPluginIds.length}{" "}
                  {t("session.pluginsActive", "plugins active")}
                </span>
              </div>
            </div>

            {/* Tab Body — Smooth internal scrolling within fixed cockpit height */}
            <div className="flex-1 overflow-y-auto ui-scroll py-4 pr-1">
              {/* Tab 1: Plugins */}
              {activeTab === "plugins" && (
                <div className="space-y-4 animate-in fade-in-0 duration-200">
                  <PluginSelectionCard
                    world={world}
                    packages={packages}
                    selectedPluginIds={selectedPluginIds}
                    selectedPluginIdSet={selectedPluginIdSet}
                    selectedPackages={selectedPackages}
                    expanded={true}
                    onToggleExpanded={() => {}}
                    bare={true}
                    pluginPacks={pluginPacks}
                    activePluginPack={activePluginPack}
                    activePluginTags={activePluginTags}
                    availablePluginTags={availablePluginTags}
                    pluginSearch={pluginSearch}
                    onPluginSearchChange={setPluginSearch}
                    onTogglePluginTag={togglePluginTag}
                    onApplyPack={applyPack}
                    pluginGroups={pluginGroups}
                    corePluginIds={corePluginIds}
                    lockedPluginIds={lockedPluginIds}
                    bindingState={bindingState}
                    resolvedSlots={resolvedSlots}
                    resolveDeclaredSlot={resolveSelectedDeclaredSlot}
                    modelControlsLocked={modelControlsLocked}
                    onTogglePlugin={togglePlugin}
                    worldDataPreflight={worldDataPreflight}
                    worldDataPreflightStatus={worldDataPreflightStatus}
                    worldDataPreflightError={worldDataPreflightError}
                    onRetryWorldDataPreflight={runWorldDataPreflight}
                    flowData={flowData}
                    selectedFlowSteps={selectedFlowSteps}
                  />
                </div>
              )}

              {/* Tab 2: AI Models */}
              {activeTab === "models" && (
                <div className="space-y-4 animate-in fade-in-0 duration-200">
                  <div className="flex items-center justify-between p-4 rounded-2xl border border-border/80 bg-background/50 backdrop-blur-xs">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">
                        {t("session.activeModels", "Configured Model Slots")}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {modelControlsLocked
                          ? t(
                              "session.modelsManagedByAdminHint",
                              "The administrator selects the active model schedule.",
                            )
                          : resolvedSlots.length > 0
                            ? t("session.slotsConfigured", {
                                count: resolvedSlots.length,
                              })
                            : t("session.slotsUnconfigured")}
                      </p>
                    </div>
                    {settingsAvailable && !modelControlsLocked && (
                      <Button
                        variant="outline"
                        size="sm"
                        radius="full"
                        className="gap-1.5 text-xs"
                        onClick={() => onSettingsOpenChange(true)}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        {t(
                          "session.configureModelRoles",
                          "Configure model roles",
                        )}
                      </Button>
                    )}
                  </div>
                  <ActiveModelSlots
                    slots={resolvedSlots}
                    modelControlsLocked={modelControlsLocked}
                  />
                </div>
              )}

              {/* Tab 3: Saved Sessions */}
              {activeTab === "history" && (
                <div className="space-y-4 animate-in fade-in-0 duration-200">
                  <SessionHistoryCard
                    activeSessions={activeSessions}
                    expanded={true}
                    onToggle={() => {}}
                    onResume={handleResume}
                    resumingId={resumingId}
                    onRequestDelete={setDeleteTarget}
                  />
                </div>
              )}
            </div>

            {/* Bottom Cockpit Action Bar */}
            <div className="pt-3 border-t border-border/80 flex items-center justify-between gap-3 sm:gap-4 shrink-0 bg-card/90 backdrop-blur-md rounded-xl sm:rounded-2xl p-2.5 sm:p-3 mt-auto sticky bottom-0 z-10">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-foreground truncate">
                  {text(world.name)}
                </span>
                <span className="text-[10px] sm:text-[11px] text-muted-foreground truncate">
                  {selectedPluginIds.length} {t("session.plugins", "plugins")} ·{" "}
                  {resolvedSlots.length}{" "}
                  {t("session.activeModels", "models ready")}
                </span>
              </div>

              <Magnet padding={40} magnetStrength={3} className="shrink-0">
                <Button
                  size="default"
                  radius="full"
                  className="h-10 sm:h-12 px-5 sm:px-8 font-bold uppercase tracking-wider text-zinc-950 bg-white hover:bg-zinc-100 shadow-lg sm:shadow-xl shadow-black/30 hover:scale-105 active:scale-95 transition-all text-xs sm:text-sm"
                  disabled={isStarting}
                  onClick={() => void handleStart()}
                >
                  {isStarting ? (
                    <Loader2 className="w-4 h-4 mr-1.5 sm:mr-2 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 fill-current" />
                  )}
                  {isStarting
                    ? t("session.startingGame", "Creating…")
                    : t("session.startGame", "Start Game")}
                </Button>
              </Magnet>
            </div>
          </div>
        </section>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("session.deleteSession", "Delete Session")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "session.deleteConfirm",
                "Are you sure you want to delete this session? This action cannot be undone.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" radius="full">
                {t("common.cancel", "Cancel")}
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              radius="full"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : null}
              {t("common.delete", "Delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Starting Game Scene Loading Transition */}
      {isStarting && (
        <SceneLoadingTransition
          image={visual.image}
          title={text(world.name)}
          subtitle={text(world.description)}
          durationMs={1800}
        />
      )}

      {/* Resuming Session Scene Loading Transition */}
      {resumingId && (
        <SceneLoadingTransition
          image={visual.image}
          title={text(world.name)}
          subtitle={t("session.resuming", "Resuming session…")}
          durationMs={1400}
        />
      )}

      {/* Returning to World Select Scene Loading Transition */}
      {isBacking && (
        <SceneLoadingTransition
          image={visual.image}
          title={t("session.breadcrumbWorldSelect")}
          subtitle={t("transition.returningWorldSelect")}
          steps={[
            t("transition.saveSession"),
            t("transition.loadArchives"),
            t("transition.readyWorldSelect"),
          ]}
          durationMs={1200}
          onComplete={() => {
            setIsBacking(false);
            onBack();
          }}
        />
      )}
    </div>
  );
}
