import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { Play, ArrowLeft, Loader2 } from "lucide-react";
import * as api from "@/services/api.js";
import { Button } from "@/components/ui/button.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { SettingsDialog } from "@/settings/SettingsDialog.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog.js";
import { SessionBreadcrumb } from "./session-breadcrumb.js";
import { text } from "@/components/world/editor-helpers.js";
import { useSlotConfig } from "@/hooks/use-slot-config.js";
import {
  isDeclaredSlotMissing,
  resolveDeclaredSlot,
} from "./session-prep/model-slot-helpers.js";
import {
  activeSessionRecords,
  removeSessionById,
  startPluginsPayload,
} from "./session-prep/session-actions.js";
import { WorldInfoCard } from "./session-prep/world-info-card.js";
import { SessionHistoryCard } from "./session-prep/session-history-card.js";
import { WorldLoreCard } from "./session-prep/world-lore-card.js";
import { DimensionActions } from "./session-prep/dimension-actions.js";
import { ModelsCard } from "./session-prep/models-card.js";
import { PluginSelectionCard } from "./session-prep/plugin-selection-card.js";
import type { SessionPrepScreenProps } from "./session-prep/types.js";
import { worldVisual } from "@/lib/world-visuals.js";
import { usePluginSelection } from "./session-prep/use-plugin-selection.js";
import { useWorldDataPreflight } from "./session-prep/use-world-data-preflight.js";
import { usePrepRuntimeBindings } from "./session-prep/use-prep-runtime-bindings.js";
import { ignoreError } from "@/lib/ignore-error.js";
import {
  defaultSelectedPluginIdsForWorld,
  isLockedCorePackage,
} from "./session-prep/plugin-selection-helpers.js";
import { ShinyText, Magnet, StarBorder } from "@/components/reactbits/index.js";
export { defaultSelectedPluginIdsForWorld, isLockedCorePackage };

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

  const [worldInfoExpanded, setWorldInfoExpanded] = useState(false);
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [loreExpanded, setLoreExpanded] = useState(false);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [pluginSectionExpanded, setPluginSectionExpanded] = useState(true);
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
  const isSelectedDeclaredSlotMissing = useCallback(
    (slotId: string) => isDeclaredSlotMissing(resolvedSlots, slotId),
    [resolvedSlots],
  );

  // In-flight guards: startGame / resume run several serial network round
  // trips, so lock the relevant button to prevent duplicate session creation
  // or double resume on a slow connection.
  const [isStarting, setIsStarting] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);

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
    <div className="flex h-full w-full overflow-hidden">
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={handleSettingsOpenChange}
        initialKey={settingsInitialKey}
      />
      <ScrollArea className="w-full h-full">
        <div className="mx-auto max-w-6xl px-4 md:px-8 py-5 md:py-8">
          <header
            className="relative mb-8 overflow-hidden rounded-3xl border border-border/80 bg-card shadow-xl"
            style={{ "--world-accent": visual.accent } as CSSProperties}
          >
            <img
              src={visual.image}
              alt=""
              aria-hidden="true"
              width={3840}
              height={2160}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover scale-[1.01] transition-transform duration-700"
              draggable={false}
            />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, rgba(9,9,11,0.88) 0%, rgba(9,9,11,0.65) 48%, rgba(9,9,11,0.3) 100%), linear-gradient(180deg, rgba(9,9,11,0.3) 0%, rgba(9,9,11,0.85) 100%)",
              }}
            />
            <div className="relative z-10 flex min-h-[250px] md:min-h-[270px] flex-col justify-between p-6 md:p-8 text-white">
              <div className="flex items-center justify-between gap-4">
                <Button
                  variant="bordered"
                  size="sm"
                  radius="full"
                  className="h-9 border-white/20 bg-black/40 px-4 text-white/90 backdrop-blur-md hover:bg-white/20 hover:text-white"
                  onClick={onBack}
                >
                  <ArrowLeft className="w-4 h-4 mr-1.5" />
                  {t("session.breadcrumbWorldSelect", "Select World")}
                </Button>
                <Magnet padding={50} magnetStrength={3}>
                  <Button
                    size="default"
                    radius="full"
                    className="h-10 px-6 font-bold uppercase tracking-wider text-zinc-950 bg-white hover:bg-zinc-100 shadow-lg shadow-black/40 hover:scale-105 active:scale-95 transition-all"
                    disabled={isStarting}
                    onClick={() => void handleStart()}
                  >
                    {isStarting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2 fill-current" />
                    )}
                    {isStarting
                      ? t("session.startingGame", "Creating…")
                      : t("session.startGame", "Start Game")}
                  </Button>
                </Magnet>
              </div>

              <div className="max-w-2xl space-y-3">
                <SessionBreadcrumb
                  step="prep"
                  worldName={text(world.name)}
                  onGoWorldSelect={onBack}
                />
                <div>
                  <p className="ui-eyebrow mb-2 text-white/60 font-mono tracking-wider">
                    {t("session.preparation", "Session Setup")}
                  </p>
                  <h1 className="ui-title text-3xl md:text-5xl font-bold leading-[1.02] text-white">
                    <ShinyText speed={5} shineColor="rgba(255, 255, 255, 0.85)">
                      {text(world.name)}
                    </ShinyText>
                  </h1>
                  <p className="mt-3 max-w-xl text-sm md:text-base leading-relaxed text-zinc-300 font-light">
                    {text(world.description)}
                  </p>
                </div>
              </div>
            </div>
          </header>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:items-start">
            <section className="min-w-0 space-y-4">
              <WorldInfoCard
                world={world}
                expanded={worldInfoExpanded}
                onToggle={() => setWorldInfoExpanded(!worldInfoExpanded)}
              />

              <SessionHistoryCard
                activeSessions={activeSessions}
                expanded={sessionsExpanded}
                onToggle={() => setSessionsExpanded(!sessionsExpanded)}
                onResume={handleResume}
                resumingId={resumingId}
                onRequestDelete={setDeleteTarget}
              />

              <WorldLoreCard
                expanded={loreExpanded}
                onToggle={() => setLoreExpanded(!loreExpanded)}
                loreValue={loreValue}
                originalLore={originalLore}
                isModified={isLoreModified}
                onLoreChange={handleLoreChange}
                onResetLore={resetLore}
              />

              <DimensionActions
                worldId={world.id}
                enabled={Boolean(world.dimensions)}
              />
            </section>

            <section className="min-w-0 space-y-4 lg:sticky lg:top-4">
              <ModelsCard
                resolvedSlots={resolvedSlots}
                expanded={modelsExpanded}
                onToggle={() => setModelsExpanded(!modelsExpanded)}
                onOpenSettings={() => onSettingsOpenChange(true)}
              />

              <PluginSelectionCard
                world={world}
                packages={packages}
                selectedPluginIds={selectedPluginIds}
                selectedPluginIdSet={selectedPluginIdSet}
                selectedPackages={selectedPackages}
                expanded={pluginSectionExpanded}
                onToggleExpanded={() =>
                  setPluginSectionExpanded(!pluginSectionExpanded)
                }
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
                isMissingDeclaredSlot={isSelectedDeclaredSlotMissing}
                onTogglePlugin={togglePlugin}
                worldDataPreflight={worldDataPreflight}
                worldDataPreflightStatus={worldDataPreflightStatus}
                worldDataPreflightError={worldDataPreflightError}
                onRetryWorldDataPreflight={runWorldDataPreflight}
                flowData={flowData}
                selectedFlowSteps={selectedFlowSteps}
              />
            </section>
          </div>
        </div>
      </ScrollArea>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("session.deleteConfirmTitle", "Delete Session")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "session.deleteConfirmDesc",
                "This will permanently delete the session and all its data (messages, game state, etc.). This action cannot be undone.",
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <p className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1.5 break-all">
              {deleteTarget.id}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm" disabled={deleting}>
                {t("common.cancel", "Cancel")}
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={handleConfirmDelete}
            >
              {deleting
                ? t("common.deleting", "Deleting...")
                : t("common.delete", "Delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
